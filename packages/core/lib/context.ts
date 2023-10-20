import type { Server, SocketAddress } from 'bun';
import { EventEmitter } from 'events';
import type { CookiesInterface } from './cookies';
import { type LoggingInterface } from './logging';
import type { ErrorHandlerInterface } from './error';
import type { App } from './app';
import type { RouteInfo, RouterInterface } from './router';
import type { EncryptionInterface } from './encryption';
import type { SessionInterface } from './session';

export class ResolutionError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export interface ContextInterface {
    has(key: ContextKey<any>): boolean;
    resolved(key: ContextKey<any>): boolean;
    get<T>(key: ContextKey<T>): T;
    set<T>(key: ContextKey<T>, instance: T, immutale?: boolean): this;
    replace<T>(key: ContextKey<T>, callback: (old: T) => T): this;
    construct<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        ...args: P
    ): Promise<InstanceType<T>>;
    singleton<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        ...args: P
    ): Promise<InstanceType<T>>;
}

export type ContextEvents<
    T extends ContextInterface = ContextInterface,
    E extends Record<string, any[]> = {},
> = {
    [key: symbol]: [instance: any, context: ContextInterface];
    resolved: [key: ContextKey<any>, instance: any, context: T];
} & E;

const defaultInstances = new Map<symbol, any>();

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
    if (value instanceof Promise) return true;
    if (typeof value !== 'object' || value === null) return false;
    return (
        'then' in value &&
        'catch' in value &&
        typeof value.then === 'function' &&
        typeof value.catch === 'function'
    );
}

export abstract class Context extends (EventEmitter as new () => {}) implements ContextInterface {
    #instances = new Map<any, any>();
    #resolvers = new Map<symbol, (container: ContextInterface) => any>();
    #immutables = new Set<symbol>();
    #classes = new Map<new (...args: any[]) => any, new (...args: any[]) => any>();

    constructor() {
        super();
    }

    register<T>(
        key: ContextKey<T>,
        resolver: (context: ContextInterface) => T,
        immutable?: boolean,
    ) {
        if (this.#immutables.has(key)) {
            throw new ResolutionError(`Cannot derive ${key.toString()}: immutable instance`);
        }
        if (immutable) {
            if (this.has(key))
                throw new ResolutionError(
                    `Cannot set ${key.toString()} as immutable: context already exists and is not immutable`,
                );
            this.#immutables.add(key);
        }
        this.#resolvers.set(key, resolver);
        return this;
    }

    derive<T>(key: ContextKey<T>, resolver: (context: ContextInterface, old: Awaited<T>) => T) {
        if (this.#immutables.has(key)) {
            throw new ResolutionError(`Cannot derive ${key.toString()}: immutable instance`);
        }
        if (!this.#resolvers.has(key)) {
            throw new ResolutionError(`Cannot derive ${key.toString()}: no resolver found`);
        }
        const original = this.#resolvers.get(key)!;
        this.#resolvers.set(key, context => {
            const old = original(context);
            if (isPromise(old)) {
                return old.then(old => resolver(context, old));
            }
            return resolver(context, old);
        });
        return this;
    }

    has(key: ContextKey<any>) {
        return this.#instances.has(key) || this.#resolvers.has(key) || defaultInstances.has(key);
    }

    get<T>(key: ContextKey<T>): T {
        return this.#resolve(key, new Set());
    }

    set<T>(key: ContextKey<T>, instance: T, immutable?: boolean) {
        if (this.#immutables.has(key)) {
            throw new ResolutionError(`Cannot set ${key.toString()}: immutable instance`);
        }
        if (immutable) {
            if (this.has(key))
                throw new ResolutionError(
                    `Cannot set ${key.toString()} as immutable: context already exists and is not immutable`,
                );
            this.#immutables.add(key);
        }
        this.#set(key, instance);
        return this;
    }

    replace<T>(key: ContextKey<T>, callback: (old: T) => T) {
        if (this.#immutables.has(key)) {
            throw new ResolutionError(`Cannot replace ${key.toString()}: immutable instance`);
        }
        const old = this.#resolve(key, new Set());
        const instance = callback(old);
        this.#set(key, instance);
        return this;
    }

    resolved(key: ContextKey<any>): boolean;
    resolved<T>(
        key: ContextKey<T>,
        callback: (instance: Awaited<T>, context: ContextInterface) => void,
    ): this;
    resolved<T>(
        key: ContextKey<T>,
        callback?: (instance: Awaited<T>, context: ContextInterface) => void,
    ) {
        if (!callback) {
            return this.#instances.has(key);
        }
        (this as any).on(key, callback);
        return this;
    }

    construct<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        ...args: P
    ): Promise<InstanceType<T>> {
        return this.#construct(type, args, new Set());
    }

    singleton<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        ...args: P
    ): Promise<InstanceType<T>> {
        return this.#singleton(type, args, new Set());
    }

    #set(key: any, instance: any): any {
        const listeners = (this as any).listeners(key);
        const inter: ContextInterface = this.#createInterface(new Set([key]));
        if (isPromise(instance)) {
            instance = instance.then(inst => {
                for (const listener of listeners) {
                    listener(inst, inter);
                }
                return inst;
            }) as any;
        } else {
            for (const listener of listeners) {
                listener(instance, inter);
            }
        }
        setImmediate(() => {
            (this as any).emit('resolved', key, instance, this as any);
        });
        this.#instances.set(key, instance);
        return instance;
    }

    #resolve<T>(
        key: ContextKey<T>,
        references: Set<ContextKey<any> | (new (...args: any[]) => any)>,
    ): T {
        if (this.#instances.has(key)) {
            return this.#instances.get(key)!;
        }
        if (references.has(key)) {
            throw new ResolutionError(
                `Circular dependency detected: ${Array.from(references)
                    .map(referenceToString)
                    .join(' -> ')} -> ${key.description ? key.description : key.toString()}`,
            );
        }
        const resolver = this.#resolvers.get(key);
        if (!resolver) {
            if (defaultInstances.has(key)) {
                this.#instances.set(key, defaultInstances.get(key));
                return defaultInstances.get(key);
            }
            throw new ResolutionError(
                `Error while resolving ${Array.from(references)
                    .map(referenceToString)
                    .join(' -> ')} -> ${key.toString()}: no resolver found`,
            );
        }
        const inter: ContextInterface = this.#createInterface(new Set([...references, key]));
        let instance = resolver(inter);
        return this.#set(key, instance);
    }

    #createInterface(
        references: Set<ContextKey<any> | (new (...args: any[]) => any)>,
    ): ContextInterface {
        const inter: ContextInterface = {
            has: _key => this.has(_key),
            resolved: _key => this.resolved(_key),
            get: _key => {
                return this.#resolve(_key, references);
            },
            set: (_key, instance) => {
                this.set(_key, instance);
                return inter;
            },
            replace: (_key, callback) => {
                this.replace(_key, callback);
                return inter;
            },
            construct: (type, ...args) => {
                return this.#construct(type, args, references);
            },
            singleton: (type, ...args) => {
                return this.#singleton(type, args, references);
            },
        };
        return inter;
    }

    async #construct<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        args: P,
        references: Set<ContextKey<any> | (new (...args: any[]) => any)>,
    ): Promise<InstanceType<T>> {
        if (references.has(type)) {
            throw new ResolutionError(
                `Circular dependency detected: ${Array.from(references)
                    .map(referenceToString)
                    .join(' -> ')} -> ${type.name}`,
            );
        }
        if (!this.#classes.has(type)) {
            const child = (() => class extends type {})();
            const wants = getWants(type.prototype);
            for (const [prop, want] of wants) {
                if (want[1].length === 0) {
                    switch (want[0]) {
                        case 'context':
                            defineProp(
                                child.prototype,
                                prop,
                                await Promise.resolve(
                                    this.#resolve(want[2], new Set([...references, type])),
                                ),
                            );
                            break;
                        case 'singleton':
                            defineProp(
                                child.prototype,
                                prop,
                                await this.#singleton(want[2], [], new Set([...references, type])),
                            );
                            break;
                    }
                    continue;
                }
                let parent = this.#resolve(want[1][0], new Set([...references, type]));
                let i = 1;
                while (i < want[1].length) {
                    parent = parent.get(want[1][i]);
                    i++;
                }
                switch (want[0]) {
                    case 'context':
                        defineProp(
                            child.prototype,
                            prop,
                            await Promise.resolve(parent.get(want[2])),
                        );
                        break;
                    case 'singleton':
                        defineProp(child.prototype, prop, await parent.singleton(want[2]));
                        break;
                }
            }
            this.#classes.set(type, child);
        }
        const c = this.#classes.get(type)!;
        const child = (() => class extends c {})();
        const wants = getWants(type.prototype);
        for (const [prop, want] of wants) {
            if (want[1].length === 0) {
                switch (want[0]) {
                    case 'construct':
                        defineProp(
                            child.prototype,
                            prop,
                            await this.#singleton(want[2], [], new Set([...references, type])),
                        );
                        break;
                }
                continue;
            }
            let parent = this.#resolve(want[1][0], new Set([...references, type]));
            let i = 1;
            while (i < want[1].length) {
                parent = parent.get(want[1][i]);
                i++;
            }
            switch (want[0]) {
                case 'construct':
                    defineProp(child.prototype, prop, await parent.singleton(want[2], ...args));
                    break;
            }
        }
        return new child(...args);
    }

    async #singleton<T extends new (...args: any[]) => any, P extends ConstructorParameters<T>>(
        type: T,
        args: P,
        references: Set<ContextKey<any> | (new (...args: any[]) => any)>,
    ): Promise<InstanceType<T>> {
        if (this.#instances.has(type)) {
            return this.#instances.get(type)!;
        }
        const instance = await this.#construct(type, args, references);
        return this.#set(type, instance);
    }
}

function defineProp(target: any, prop: any, value: any) {
    Object.defineProperty(target, prop, {
        get() {
            return value;
        },
    });
}

function referenceToString(ref: ContextKey<any> | (new (...args: any[]) => any)) {
    if (typeof ref === 'symbol') {
        return ref.description ? ref.description : ref.toString();
    }
    return ref.name;
}

// only for type checking
declare class CtxKey<_> {}

export type ContextKey<T> = CtxKey<T> & symbol;

export type ContextValue<T> = T extends ContextKey<infer U> ? U : never;

export function createContextKey<T>(name: string): ContextKey<T> {
    return Symbol(name) as ContextKey<T>;
}

/**
 * Common context keys
 */
export const key = {
    app: createContextKey<App>('app'),
    server: createContextKey<Server>('server'),
    logging: createContextKey<LoggingInterface>('logging'),
    router: createContextKey<RouterInterface>('router'),
    encryption: createContextKey<EncryptionInterface>('encryption'),
    request: Object.assign(createContextKey<Request>('request'), {
        address: createContextKey<SocketAddress | null>('request.address'),
        cookies: createContextKey<Promise<CookiesInterface>>('request.cookies'),
        session: createContextKey<Promise<SessionInterface>>('request.session'),
        route: createContextKey<RouteInfo>('request.route'),
        errorHandler: createContextKey<ErrorHandlerInterface>('error-handler'),
    }),
};

const kWants = Symbol('wants');

type Last<Arr extends any[]> = Arr extends [...infer _, infer L] ? L : never;

type Wants = Map<
    string | symbol | number,
    | [type: 'context', parents: ContextKey<ContextInterface>[], key: ContextKey<any>]
    | [
          type: 'construct' | 'singleton',
          parents: ContextKey<ContextInterface>[],
          type: new (...args: any[]) => any,
      ]
>;

export function context<
    Contexts extends [...contexts: ContextKey<ContextInterface>[], context: ContextKey<any>],
    Target,
    PropertyKey extends keyof Target,
>(...contexts: Contexts) {
    return (
        target: Target,
        propertyKey: Target[PropertyKey] extends Awaited<ContextValue<Last<Contexts>>>
            ? PropertyKey
            : never,
    ) => {
        if (!Reflect.hasMetadata(kWants, target as any)) {
            Reflect.defineMetadata(kWants, new Map(), target as any);
        }
        const wants = Reflect.getMetadata(kWants, target as any) as Wants;
        const parents = contexts.slice(0, -1);
        const key = contexts[contexts.length - 1];
        wants.set(propertyKey, ['context', parents, key]);
    };
}

export function construct<
    Contexts extends [...contexts: ContextKey<ContextInterface>[], context: new () => any],
    Target,
    PropertyKey extends keyof Target,
>(...contexts: Contexts) {
    return (
        target: Target,
        propertyKey: Target[PropertyKey] extends InstanceType<Last<Contexts>> ? PropertyKey : never,
    ) => {
        if (!Reflect.hasMetadata(kWants, target as any)) {
            Reflect.defineMetadata(kWants, new Map(), target as any);
        }
        const wants = Reflect.getMetadata(kWants, target as any) as Wants;
        const parents = contexts.slice(0, -1);
        const type = contexts[contexts.length - 1];
        wants.set(propertyKey, ['construct', parents, type] as any);
    };
}

export function singleton<
    Contexts extends [...contexts: ContextKey<ContextInterface>[], context: new () => any],
    Target,
    PropertyKey extends keyof Target,
>(...contexts: Contexts) {
    return (
        target: Target,
        propertyKey: Target[PropertyKey] extends InstanceType<Last<Contexts>> ? PropertyKey : never,
    ) => {
        if (!Reflect.hasMetadata(kWants, target as any)) {
            Reflect.defineMetadata(kWants, new Map(), target as any);
        }
        const wants = Reflect.getMetadata(kWants, target as any) as Wants;
        const parents = contexts.slice(0, -1);
        const type = contexts[contexts.length - 1];
        wants.set(propertyKey, ['singleton', parents, type] as any);
    };
}

function getWants(target: any): Wants {
    const res: Wants = new Map();
    let current = target;
    while (current) {
        const wants = Reflect.getMetadata(kWants, current) as Wants | undefined;
        if (!wants) {
            current = Object.getPrototypeOf(current);
            continue;
        }
        for (const [prop, want] of wants) {
            if (res.has(prop)) continue;
            res.set(prop, want);
        }
        current = Object.getPrototypeOf(current);
    }
    return res;
}
