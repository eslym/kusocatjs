/// <reference path="../../../node_modules/reflect-metadata/index.d.ts"/>

import type { RequestContext } from './app';
import { join } from 'path/posix';
import { key } from './context';
import { RedirectError } from '..';

type Awaitable<T> = T | Promise<T>;
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ResponseType = Response | Blob | 'upgraded';

export type MiddlewareFunction = (
    context: RequestContext,
    next: () => Promise<Response | 'upgraded'>,
) => Promise<ResponseType>;

export type HandlerFunction = (context: RequestContext) => Awaitable<ResponseType>;

interface RouteOptions {
    name?: string;
    use?: MiddlewareFunction | MiddlewareFunction[];
}

interface GroupOptions {
    prefix?: string;
    use?: MiddlewareFunction | MiddlewareFunction[];
}

interface RouteInterface {
    readonly method: Method[];
    readonly path: string;
    readonly pattern: string;
    readonly action: HandlerFunction | Action;
    readonly middleware: MiddlewareFunction[];
    readonly handler: HandlerFunction;

    use(middleware: MiddlewareFunction | MiddlewareFunction[]): RouteInterface;

    name(): string | undefined;
    name(name: string): RouteInterface;
}

type FallbackRouteInterface = Omit<RouteInterface, 'method' | 'path'>;

type RegisterRouteFunction = {
    <C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    (path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
};

type ActionMethod = (ctx: RequestContext, ...args: any[]) => Awaitable<ResponseType>;

type Action<
    C extends new () => any = new () => any,
    A extends keyof InstanceType<C> = string,
> = InstanceType<C>[A] extends ActionMethod ? readonly [controller: C, action: A] : never;

const regexEscapeChars = /[-/\\^$*+?.()|[\]{}]/g;

function escapeRegex(string: string) {
    return string.replace(regexEscapeChars, '\\$&');
}

function normalizePath(path: string) {
    return join(path.replace(/\/$/, '').replace(/^\/?/, '/').replace(/\/+/g, '/'));
}

function* scanParts(path: string) {
    const regex = /\/?[^/]+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(path))) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        yield match[0].slice(1);
    }
}

const PARTS = {
    [Symbol.split](path: string) {
        return Array.from(scanParts(path));
    },
};

type ParamRule = {
    pattern: string;
    params: number;
    statics: number;
};

type Rule = string | ParamRule;

function evaluateRule(part: string): Rule {
    if (!/\{[a-z_][a-z0-9_]*?\}/i.test(part)) {
        return part;
    }
    const regex = /(?:\{[a-z_][a-z0-9_]*?\})/gi;
    let pattern = '';
    let params = 0;
    let statics = 0;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    while ((match = regex.exec(part))) {
        pattern += escapeRegex(part.slice(lastIndex, match.index));
        statics += match.index - lastIndex;
        lastIndex = regex.lastIndex;
        pattern += `(?<${match[0].slice(1, -1)}>[^/]+?)`;
        params++;
    }
    pattern += escapeRegex(part.slice(lastIndex));
    statics += part.length - lastIndex;
    return {
        pattern: pattern,
        params,
        statics,
    };
}

function compileRule(rule: string) {
    let pattern = '';
    for (const part of scanParts(rule)) {
        pattern += '\\/';
        const evaluated = evaluateRule(part);
        if (typeof evaluated === 'string') {
            pattern += escapeRegex(evaluated);
        } else {
            pattern += evaluated.pattern;
        }
    }
    return pattern;
}

function sortParamRule(a: ParamRule, b: ParamRule) {
    return b.params - a.params || b.statics - a.statics;
}

export interface RouteInfo {
    readonly name?: string;
    readonly route: string;
    readonly rule: string;
    readonly params: Map<string, string>;
}

export interface ResolvedRoute extends RouteInfo {
    readonly handler: HandlerFunction;
    readonly middleware: MiddlewareFunction[];
}

export interface RouterInterface {
    resolve(ctx: RequestContext): Promise<ResolvedRoute | undefined> | ResolvedRoute | undefined;
}

export interface RouteRegistrarInterface {
    prefix(prefix: string): RouteRegistrarInterface;
    name(name: string): RouteRegistrarInterface;
    use(middleware: MiddlewareFunction | MiddlewareFunction[]): RouteRegistrarInterface;

    get: RegisterRouteFunction;
    post: RegisterRouteFunction;
    put: RegisterRouteFunction;
    patch: RegisterRouteFunction;
    delete: RegisterRouteFunction;

    match<C extends new () => any = new () => any, A extends keyof InstanceType<C> = string>(
        methods: Method[],
        path: string,
        handler: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;

    match(
        methods: Method[],
        path: string,
        handler: HandlerFunction,
        options?: RouteOptions,
    ): RouteInterface;

    group(
        path: string,
        callback: (group: RouteRegistrarInterface) => void,
        options?: GroupOptions,
    ): this;
    group(callback: (group: RouteRegistrarInterface) => void, options?: GroupOptions): this;

    fallback<C extends new () => any, A extends keyof InstanceType<C>>(
        action: Action<C, A>,
        options?: RouteOptions,
    ): FallbackRouteInterface;
    fallback(handler: HandlerFunction, options?: RouteOptions): FallbackRouteInterface;
}

class Matcher {
    #route?: RouteInterface;
    #fallback?: FallbackRouteInterface;
    #exact: Map<string, Matcher> = new Map();
    #param: Map<string, Matcher> = new Map();
    #sorted: ParamRule[] = [];

    put(parts: string[], route: RouteInterface, fallback: boolean = false) {
        if (parts.length === 0) {
            if (fallback) {
                this.#fallback = route;
            } else {
                this.#route = route;
            }
            return;
        }
        const [part, ...rest] = parts;
        const rule = evaluateRule(part);
        if (typeof rule === 'string') {
            if (!this.#exact.has(part)) {
                this.#exact.set(part, new Matcher());
            }
            this.#exact.get(part)!.put(rest, route, fallback);
            return;
        }
        if (!this.#param.has(rule.pattern)) {
            this.#param.set(rule.pattern, new Matcher());
        }
        this.#param.get(rule.pattern)!.put(rest, route, fallback);
        this.#sorted = [...this.#sorted, rule].sort(sortParamRule);
    }

    resolve(
        parts: string[],
        params: Map<string, string>,
    ): { route: RouteInterface | FallbackRouteInterface; params: Map<string, string> } | undefined {
        if (parts.length === 0) {
            if (this.#route) {
                return { route: this.#route, params };
            }
            if (this.#fallback) {
                return { route: this.#fallback, params };
            }
            return undefined;
        }
        const [part, ...rest] = parts;
        if (this.#exact.has(part)) {
            return this.#exact.get(part)!.resolve(rest, params);
        }
        let res:
            | { route: RouteInterface | FallbackRouteInterface; params: Map<string, string> }
            | undefined = undefined;
        for (const rule of this.#sorted) {
            const match = new RegExp(`^${rule.pattern}$`).exec(part);
            const p = new Map(params);
            if (match) {
                for (const [key, value] of Object.entries(match.groups ?? {})) {
                    p.set(key, value);
                }
                res = this.#param.get(rule.pattern)!.resolve(rest, p);
                if (res) return res;
            }
        }
        if (this.#fallback) {
            return { route: this.#fallback, params };
        }
        return undefined;
    }
}

export class Router implements RouterInterface, RouteRegistrarInterface {
    #namedRoutes: Map<string, RouteInterface> = new Map();
    #matchers: Map<Method, Matcher> = new Map();

    resolve(ctx: RequestContext): ResolvedRoute | undefined {
        const req = ctx.get(key.request);
        const method = req.method === 'HEAD' ? 'GET' : (req.method as Method);
        const matcher = this.#matchers.get(method);
        if (!matcher) {
            return undefined;
        }
        const url = new URL(req.url);
        const path = normalizePath(decodeURI(url.pathname));
        const parts = path.split(PARTS);
        const params = new Map<string, string>();
        const res = matcher.resolve(parts, params);
        if (!res) {
            return undefined;
        }
        if (url.pathname.endsWith('/') && url.pathname !== '/') {
            const newUrl = new URL(url.toString());
            newUrl.pathname = encodeURI(path);
            throw new RedirectError(newUrl.toString(), 307);
        }
        const route = res.route as RouteInterface;
        return {
            get name() {
                return route.name();
            },
            get route() {
                return route.path;
            },
            get rule() {
                return route.pattern;
            },
            get params() {
                return res.params;
            },
            get handler() {
                return route.handler;
            },
            get middleware() {
                return route.middleware;
            },
        };
    }

    generate(name: string, params: Record<string, string> = {}): string {
        const route = this.#namedRoutes.get(name);
        if (!route) {
            throw new Error(`Route "${name}" does not exist`);
        }
        let path = route.path;
        for (const [key, value] of Object.entries(params)) {
            path = path.replace(`{${key}}`, value);
        }
        return path;
    }

    prefix(prefix: string): RouteRegistrarInterface {
        return new RouteRegistrar(this).prefix(prefix);
    }

    name(name: string): RouteRegistrarInterface {
        return new RouteRegistrar(this).name(name);
    }

    use(middleware: MiddlewareFunction | MiddlewareFunction[]): RouteRegistrarInterface {
        return new RouteRegistrar(this).use(middleware);
    }

    get<C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    get(path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
    get(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['GET'], path, action, options || {});
    }

    post<C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    post(path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
    post(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['POST'], path, action, options || {});
    }

    put<C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    put(path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
    put(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['PUT'], path, action, options || {});
    }

    patch<C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    patch(path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
    patch(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['PATCH'], path, action, options || {});
    }

    delete<C extends new () => any, A extends keyof InstanceType<C>>(
        path: string,
        action: Action<C, A>,
        options?: RouteOptions,
    ): RouteInterface;
    delete(path: string, handler: HandlerFunction, options?: RouteOptions): RouteInterface;
    delete(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['DELETE'], path, action, options || {});
    }

    match(
        methods: Method[],
        path: string,
        action: HandlerFunction | Action,
        options: RouteOptions = {},
    ): RouteInterface {
        return this.#createRoute(methods, path, action, options);
    }

    fallback<C extends new () => any, A extends keyof InstanceType<C>>(
        action: Action<C, A>,
        options?: RouteOptions | undefined,
    ): FallbackRouteInterface;
    fallback(handler: HandlerFunction, options?: RouteOptions | undefined): FallbackRouteInterface;
    fallback(handler: unknown, options?: unknown): FallbackRouteInterface {
        return this.#createRoute([], '', handler as any, options as any, true);
    }

    group(
        path: string,
        callback: (group: RouteRegistrarInterface) => void,
        options?: GroupOptions,
    ): this;
    group(callback: (group: RouteRegistrarInterface) => void, options?: GroupOptions): this;
    group(
        a1: string | ((group: RouteRegistrarInterface) => void),
        a2?: ((group: RouteRegistrarInterface) => void) | GroupOptions,
        a3?: GroupOptions,
    ) {
        const path = typeof a1 === 'string' ? a1 : '/';
        const callback =
            typeof a1 === 'function' ? a1 : (a2 as (group: RouteRegistrarInterface) => void);
        const options = typeof a1 === 'function' ? (a2 as GroupOptions) : a3 ?? {};
        const group = this.#createGroup(path, options);
        callback(group);
        return this;
    }

    #createGroup(path: string, options: GroupOptions): RouteRegistrarInterface {
        let prefix: string | undefined = options.prefix;

        let use: MiddlewareFunction[] =
            typeof options.use === 'function' ? [options.use] : options.use ?? [];

        const group: RouteRegistrarInterface = {
            prefix: (val: string) => {
                return new RouteRegistrar(group).prefix(val);
            },
            name: (val: string) => {
                return new RouteRegistrar(group).name(val);
            },
            use: (mid: MiddlewareFunction | MiddlewareFunction[]) => {
                return new RouteRegistrar(group).use(mid);
            },
            group: ((a1: any, a2: any, a3: any) => {
                return new RouteRegistrar(group).group(a1, a2, a3);
            }) as any,
            get(path: string, action: HandlerFunction | Action, options?: RouteOptions) {
                return this.match(['GET'], path, action as any, options || {});
            },
            post(path: string, action: HandlerFunction | Action, options?: RouteOptions) {
                return this.match(['POST'], path, action as any, options || {});
            },
            put(path: string, action: HandlerFunction | Action, options?: RouteOptions) {
                return this.match(['PUT'], path, action as any, options || {});
            },
            patch(path: string, action: HandlerFunction | Action, options?: RouteOptions) {
                return this.match(['PATCH'], path, action as any, options || {});
            },
            delete(path: string, action: HandlerFunction | Action, options?: RouteOptions) {
                return this.match(['DELETE'], path, action as any, options || {});
            },
            match: (
                methods: Method[],
                p: string,
                action: HandlerFunction | Action,
                options: RouteOptions = {},
            ) => {
                const name = options.name ? (prefix ?? '') + options.name : undefined;
                p = path + normalizePath(p);
                const middleware = [
                    ...use,
                    ...(typeof options.use === 'function' ? [options.use] : options.use ?? []),
                ];
                const route = this.#createRoute(methods, p, action as any, {
                    ...options,
                    use: middleware,
                    prefix,
                    name,
                });
                return route;
            },
            fallback: (action: HandlerFunction | Action, options: RouteOptions = {}) => {
                const middleware = [
                    ...use,
                    ...(typeof options.use === 'function' ? [options.use] : options.use ?? []),
                ];
                return this.#createRoute(
                    [],
                    path,
                    action as any,
                    {
                        ...options,
                        use: middleware,
                        prefix,
                    },
                    true,
                );
            },
        };

        return group;
    }

    #createRoute(
        method: Method[],
        path: string,
        action: HandlerFunction | Action,
        options: RouteOptions & GroupOptions,
        fallback: boolean = false,
    ): RouteInterface {
        method = [...method];
        path = normalizePath(path);
        action = typeof action === 'function' ? action : [action[0], action[1]];
        let middleware: MiddlewareFunction[] =
            typeof options.use === 'function' ? [options.use] : options.use ?? [];
        if (typeof action !== 'function') {
            const [controller, actionName] = action;
            const use = getUse(controller.prototype, actionName);
            middleware = [...use, ...middleware];
        }
        let prefix: string | undefined = options.prefix;
        let pattern: string | undefined = undefined;
        let name: string | undefined = options.name ? (prefix ?? '') + options.name : undefined;
        let handler: HandlerFunction | undefined =
            typeof action === 'function' ? action : undefined;
        const route: RouteInterface = {
            get method() {
                return method;
            },
            get path() {
                return path;
            },
            get action() {
                return action;
            },
            get pattern() {
                return pattern ?? (pattern = compileRule(prefix ? prefix + path : path));
            },
            get middleware() {
                return middleware;
            },
            get handler(): HandlerFunction {
                if (!handler) {
                    handler = actionToHandler(action as Action);
                }
                return handler;
            },
            use(mid: MiddlewareFunction | MiddlewareFunction[]) {
                middleware = typeof mid === 'function' ? [mid] : mid;
                return this;
            },
            name: ((val?: string) => {
                if (val === undefined) {
                    return name;
                }
                if (this.#namedRoutes.get(val) === route) {
                    this.#namedRoutes.delete(val);
                }
                name = (prefix ?? '') + val;
                this.#namedRoutes.set(name, route);
                return this;
            }) as any,
        };
        if (name) {
            this.#namedRoutes.set(name, route);
        }
        const parts = path.split(PARTS);
        for (const m of method) {
            if (!this.#matchers.has(m)) {
                this.#matchers.set(m, new Matcher());
            }
            this.#matchers.get(m)!.put(parts, route, fallback);
        }
        return route;
    }
}

class RouteRegistrar implements RouteRegistrarInterface {
    #options: {
        prefix?: string;
        name?: string;
        domain?: string;
        use: MiddlewareFunction[];
    } = {
        use: [],
    };
    #parent: RouteRegistrarInterface;

    constructor(parent: RouteRegistrarInterface) {
        this.#parent = parent;
    }

    get(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['GET'], path, action, options || {});
    }

    post(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['POST'], path, action, options || {});
    }

    put(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['PUT'], path, action, options || {});
    }

    patch(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['PATCH'], path, action, options || {});
    }

    delete(path: string, action: HandlerFunction | Action, options?: RouteOptions): RouteInterface {
        return this.match(['DELETE'], path, action, options || {});
    }

    match(
        methods: Method[],
        path: string,
        action: HandlerFunction | Action,
        options: RouteOptions = {},
    ): RouteInterface {
        const opts = this.#mergeOptions(options, path);
        return this.#parent.match(methods, opts.path, action as any, opts);
    }

    name(name: string) {
        return this.#clone({ name }, '');
    }

    prefix(prefix: string) {
        return this.#clone({ prefix }, '');
    }

    use(middleware: MiddlewareFunction | MiddlewareFunction[]) {
        return this.#clone({ use: middleware }, '');
    }

    group(
        a1: ((group: RouteRegistrarInterface) => void) | string,
        a2?: ((group: RouteRegistrarInterface) => void) | GroupOptions,
        a3?: GroupOptions,
    ) {
        const path = typeof a1 === 'string' ? a1 : '/';
        const callback =
            typeof a1 === 'function' ? a1 : (a2 as (group: RouteRegistrarInterface) => void);
        const options = (typeof a1 === 'function' ? (a2 as GroupOptions) : a3) ?? {};
        const opts = this.#mergeOptions(options, path);
        this.#parent.group(path, callback, opts);
        return this;
    }

    fallback(action: Action | HandlerFunction, options: RouteOptions = {}) {
        const opts = this.#mergeOptions(options, '');
        return this.#parent.fallback(action as any, opts);
    }

    #mergeOptions(options: RouteOptions | GroupOptions, path: string) {
        const use = options.use
            ? typeof options.use === 'function'
                ? [options.use]
                : options.use
            : [];
        return {
            ...this.#options,
            ...options,
            path,
            use: [...this.#options.use, ...use],
        };
    }

    #clone(options: RouteOptions | GroupOptions, path: string) {
        const clone = new RouteRegistrar(this.#parent);
        clone.#options = this.#mergeOptions(options, path);
        return clone;
    }
}

type Params = Map<number, string>;

const kUse = Symbol('use');
const kParam = Symbol('param');

export function use<A, B extends keyof A>(middleware: MiddlewareFunction | MiddlewareFunction[]) {
    middleware = typeof middleware === 'function' ? [middleware] : middleware;
    return (target: A, propertyKey: A[B] extends ActionMethod ? B : never) => {
        if (!Reflect.hasMetadata(kUse, target as any)) {
            Reflect.defineMetadata(kUse, new Set<MiddlewareFunction>(), target as any);
        }
        const use = Reflect.getMetadata(kUse, target as any) as Set<MiddlewareFunction>;
        (middleware as MiddlewareFunction[]).forEach(m => use.add(m));
    };
}

export function param<A, B extends keyof A>(name: string) {
    return (target: A, propertyKey: A[B] extends ActionMethod ? B : never, index: number) => {
        if (!Reflect.hasMetadata(kParam, target as any, propertyKey as any)) {
            Reflect.defineMetadata(kParam, new Map(), target as any, propertyKey as any);
        }
        const params = Reflect.getMetadata(kParam, target as any, propertyKey as any) as Params;
        params.set(index, name);
    };
}

function getUse(target: any, actionName: string): MiddlewareFunction[] {
    const use: MiddlewareFunction[][] = [];
    let current = target;
    while (current) {
        const middlewares = Reflect.getMetadata(kUse, current, actionName) as
            | Set<MiddlewareFunction>
            | undefined;
        if (!middlewares) {
            current = Object.getPrototypeOf(current);
            continue;
        }
        const uses: MiddlewareFunction[] = [];
        for (const middleware of middlewares) {
            if (!uses.includes(middleware)) {
                uses.push(middleware);
            }
        }
        use.unshift(uses);
        current = Object.getPrototypeOf(current);
    }
    return use.flat();
}

function getParams(target: any, actionName: string): Params | undefined {
    return Reflect.getMetadata(kParam, target, actionName);
}

function actionToHandler(action: Action): HandlerFunction {
    return async ctx => {
        const [controller, method] = action;
        const instance = await ctx.singleton(controller);
        const args = [];
        const params = getParams(controller.prototype, method);
        const route = ctx.get(key.request.route);
        if (params) {
            for (const [index, name] of params.entries()) {
                args[index - 1] = route.params.get(name);
            }
        }
        return instance[method](ctx, ...args);
    };
}
