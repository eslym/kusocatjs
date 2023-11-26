import type {
    Server,
    ServerWebSocket,
    WebSocketHandler as BunWSHandler,
    WebSocketServeOptions,
    UnixWebSocketServeOptions,
    TLSWebSocketServeOptions,
    UnixTLSWebSocketServeOptions,
} from 'bun';
import { Context, key, type ContextEvents } from './context';
import { HTTPError, RedirectError, defaultErrorHandler } from './error';
import { type MiddlewareFunction, type ResponseType } from './router';
import { Cookies } from './cookies';
import { defaultLogging } from './logging';

// somehow this is needed for the type to be correct, import { EventEmitter } from 'events' doesn't work
interface EventEmitter<
    Events extends Record<string | symbol, any[]> = Record<string | symbol, any[]>,
> {
    addListener<K extends keyof Events>(eventName: K, listener: (...args: Events[K]) => void): this;
    on<K extends keyof Events>(eventName: K, listener: (...args: Events[K]) => void): this;
    once<K extends keyof Events>(eventName: K, listener: (...args: Events[K]) => void): this;
    removeListener<K extends keyof Events>(
        eventName: K,
        listener: (...args: Events[K]) => void,
    ): this;
    off<K extends keyof Events>(eventName: K, listener: (...args: Events[K]) => void): this;
    removeAllListeners(event?: keyof Events): this;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    listeners(eventName: keyof Events): Function[];
    rawListeners(eventName: keyof Events): Function[];
    emit<K extends keyof Events>(eventName: K, ...args: Events[K]): boolean;
    listenerCount(eventName: keyof Events): number;
    prependListener<K extends keyof Events>(
        eventName: K,
        listener: (...args: Events[K]) => void,
    ): this;
    prependOnceListener<K extends keyof Events>(
        eventName: K,
        listener: (...args: Events[K]) => void,
    ): this;
    eventNames(): Array<string | symbol>;
}

export interface WebSocketHandler {
    message(ws: ServerWebSocket<WebSocketHandler>, message: string | Buffer): void | Promise<void>;

    open?(ws: ServerWebSocket<WebSocketHandler>): void | Promise<void>;

    drain?(ws: ServerWebSocket<WebSocketHandler>): void | Promise<void>;

    close?(
        ws: ServerWebSocket<WebSocketHandler>,
        code: number,
        reason: string,
    ): void | Promise<void>;

    ping?(ws: ServerWebSocket<WebSocketHandler>, data: Buffer): void | Promise<void>;

    pong?(ws: ServerWebSocket<WebSocketHandler>, data: Buffer): void | Promise<void>;
}

type RequestContextEvents = {
    upgraded: [context: RequestContext];
    finishing: [
        context: RequestContext,
        response: Response,
        setResponse: (response: Response) => void | Promise<void>,
    ];
    finished: [context: RequestContext, response: Response];
};

type HelperFunction = (ctx: RequestContext, ...args: any[]) => any;

type Helper<T extends HelperFunction> = T extends {
    (ctx: RequestContext, ...args: infer A1): infer R1;
    (ctx: RequestContext, ...args: infer A2): infer R2;
    (ctx: RequestContext, ...args: infer A3): infer R3;
    (ctx: RequestContext, ...args: infer A4): infer R4;
    (ctx: RequestContext, ...args: infer A5): infer R5;
    (ctx: RequestContext, ...args: infer A6): infer R6;
}
    ? {
          (...args: A1): R1;
          (...args: A2): R2;
          (...args: A3): R3;
          (...args: A4): R4;
          (...args: A5): R5;
          (...args: A6): R6;
      }
    : T extends {
          (ctx: RequestContext, ...args: infer A1): infer R1;
          (ctx: RequestContext, ...args: infer A2): infer R2;
          (ctx: RequestContext, ...args: infer A3): infer R3;
          (ctx: RequestContext, ...args: infer A4): infer R4;
          (ctx: RequestContext, ...args: infer A5): infer R5;
      }
    ? {
          (...args: A1): R1;
          (...args: A2): R2;
          (...args: A3): R3;
          (...args: A4): R4;
          (...args: A5): R5;
      }
    : T extends {
          (ctx: RequestContext, ...args: infer A1): infer R1;
          (ctx: RequestContext, ...args: infer A2): infer R2;
          (ctx: RequestContext, ...args: infer A3): infer R3;
          (ctx: RequestContext, ...args: infer A4): infer R4;
      }
    ? {
          (...args: A1): R1;
          (...args: A2): R2;
          (...args: A3): R3;
          (...args: A4): R4;
      }
    : T extends {
          (ctx: RequestContext, ...args: infer A1): infer R1;
          (ctx: RequestContext, ...args: infer A2): infer R2;
          (ctx: RequestContext, ...args: infer A3): infer R3;
      }
    ? {
          (...args: A1): R1;
          (...args: A2): R2;
          (...args: A3): R3;
      }
    : T extends {
          (ctx: RequestContext, ...args: infer A1): infer R1;
          (ctx: RequestContext, ...args: infer A2): infer R2;
      }
    ? {
          (...args: A1): R1;
          (...args: A2): R2;
      }
    : T extends {
          (ctx: RequestContext, ...args: infer A): infer R;
      }
    ? (...args: A) => R
    : never;

export interface RequestContext
    extends EventEmitter<ContextEvents<RequestContext, RequestContextEvents>> {}

type RedirectResponse = Response & {
    with(data: Record<string, any>): RedirectResponsePromise;
    with(key: string, value: any): RedirectResponsePromise;
};

type RedirectResponsePromise = Promise<RedirectResponse> & {
    with(data: Record<string, any>): RedirectResponsePromise;
    with(key: string, value: any): RedirectResponsePromise;
};

export class RequestContext extends Context {
    #app: App;
    #server: Server;
    #request: Request;

    get app() {
        return this.#app;
    }

    get request() {
        return this.#request;
    }

    get server() {
        return this.#server;
    }

    constructor(app: App, server: Server, request: Request) {
        super();
        this.set(key.app, (this.#app = app), true);
        this.set(key.server, (this.#server = server), true);
        this.set(key.request, (this.#request = request));
    }

    upgrade(handler: WebSocketHandler, headers?: HeadersInit) {
        if (
            this.#server.upgrade(this.#request, {
                headers,
                data: handler,
            })
        ) {
            return 'upgraded';
        }
        return false;
    }

    eventNames() {
        return ['resolved', 'upgraded', 'finishing', 'finished'];
    }

    url(path: string): string;
    url(path: string, query: Record<string, string>): string;
    url(path: string, query: [string, string][]): string;
    url(path: string, query: URLSearchParams): string;
    url(path: string, query?: Record<string, string> | [string, string][] | URLSearchParams) {
        const url = new URL(path, this.get(key.request).url);
        if (query) {
            if (query instanceof URLSearchParams) {
            } else {
                url.search = new URLSearchParams(query).toString();
            }
        } else {
            url.search = '';
        }
        return url.toString();
    }

    redirect(
        url: string,
        status: 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 = 302,
        headers?: HeadersInit,
    ): RedirectResponsePromise | RedirectResponse {
        const res = this.get(key.request.errorHandler).render(
            new RedirectError(url, status, headers),
        );
        const self = this;
        const promiseFluent = {
            with(
                this: RedirectResponsePromise,
                keyOrData: string | Record<string, any>,
                value?: any,
            ): RedirectResponsePromise {
                return Object.assign(
                    this.then(res => res.with(keyOrData as any, value)),
                    promiseFluent,
                );
            },
        };
        const resFluent = {
            with(
                this: RedirectResponse,
                keyOrData: string | Record<string, any>,
                value?: any,
            ): RedirectResponsePromise {
                return Object.assign(
                    self.get(key.request.session).then(session => {
                        if (typeof keyOrData === 'string') {
                            session.flash(keyOrData, value);
                        } else {
                            Object.entries(keyOrData).forEach(([key, value]) =>
                                session.flash(key, value),
                            );
                        }
                        return this;
                    }),
                    promiseFluent,
                );
            },
        };
        if (res instanceof Promise) {
            return Object.assign(
                res.then(res => Object.assign(res, resFluent)),
                promiseFluent,
            );
        }
        return Object.assign(res, resFluent);
    }

    helper<T extends HelperFunction>(fn: T): Helper<T> {
        return ((...args: any[]) => fn(this, ...args)) as Helper<T>;
    }
}

type AppEvents = {
    request: [request: RequestContext, app: App];
};

export type AppWebsocketOptions = Omit<BunWSHandler, keyof WebSocketHandler>;

export type AppServeOptions =
    | (Omit<WebSocketServeOptions, 'fetch' | 'websocket'> & { websocket?: AppWebsocketOptions })
    | (Omit<TLSWebSocketServeOptions, 'fetch' | 'websocket'> & { websocket?: AppWebsocketOptions })
    | (Omit<UnixWebSocketServeOptions, 'fetch' | 'websocket'> & { websocket?: AppWebsocketOptions })
    | (Omit<UnixTLSWebSocketServeOptions, 'fetch' | 'websocket'> & {
          websocket?: AppWebsocketOptions;
      });

export interface App extends EventEmitter<ContextEvents<App, AppEvents>> {}

export class App extends Context {
    #middleware: MiddlewareFunction[] = [];
    #server?: Server = undefined;

    get server() {
        if (!this.#server) {
            throw new Error('Server not running');
        }
        return this.#server;
    }

    constructor() {
        super();
        this.set(key.app, this).set(key.logging, defaultLogging);
    }

    use(middleware: MiddlewareFunction | MiddlewareFunction[], prepend: boolean = false) {
        middleware = typeof middleware === 'function' ? [middleware] : middleware;
        this.#middleware = prepend
            ? [...middleware, ...this.#middleware]
            : [...this.#middleware, ...middleware];
        return this;
    }

    serve(options: AppServeOptions) {
        if (this.#server) {
            throw new Error('Server already running');
        }
        const opts = {
            ...options,
            fetch: this.#handle.bind(this),
            websocket: {
                ...(this.#websocket ?? {}),
                ...options.websocket,
            },
        };
        this.#server = Bun.serve(opts);
        return this;
    }

    stop(closeActiveConnections: boolean) {
        if (!this.#server) {
            throw new Error('Server not running');
        }
        this.#server.stop(closeActiveConnections);
        this.#server = undefined;
        return this;
    }

    #websocket: WebSocketHandler = {
        message: (ws, message) => {
            ws.data.message(ws, message);
        },
        open: ws => {
            ws.data.open?.(ws);
        },
        drain: ws => {
            ws.data.drain?.(ws);
        },
        close: (ws, code, reason) => {
            ws.data.close?.(ws, code, reason);
        },
        ping: (ws, data) => {
            ws.data.ping?.(ws, data);
        },
        pong: (ws, data) => {
            ws.data.pong?.(ws, data);
        },
    };

    async #handle(request: Request, server: Server) {
        const router = this.get(key.router);
        const addr = server.requestIP(request);
        const ctx = new RequestContext(this, server, request);

        ctx.set(key.request.address, addr)
            .register(key.request.cookies, Cookies.factory)
            .register(key.request.errorHandler, () => defaultErrorHandler);

        try {
            for (const setup of this.listeners('request')) {
                const val = setup(ctx, this);
                if (val instanceof Promise) {
                    await val;
                }
            }

            const r = router.resolve(ctx);

            const route = r instanceof Promise ? await r : r;

            if (route) {
                ctx.set(key.request.route, {
                    get params() {
                        return route.params;
                    },
                    get name() {
                        return route.name;
                    },
                    get rule() {
                        return route.rule;
                    },
                    get route() {
                        return route.route;
                    },
                });
            }

            const middleware = [...this.#middleware, ...(route?.middleware ?? [])];
            const handler =
                route?.handler ??
                (ctx => {
                    const req = ctx.get(key.request);
                    if (req.method === 'GET' || req.method === 'HEAD') {
                        throw new HTTPError(404);
                    }
                    throw new HTTPError(405);
                });

            let index = 0;

            const next = async () => {
                let res: Promise<ResponseType> | ResponseType;
                try {
                    if (index < middleware.length) {
                        const nextMiddleware = middleware[index++];
                        res = nextMiddleware(ctx, next);
                    } else {
                        res = handler(ctx);
                    }
                    res = res instanceof Promise ? await res : res;
                    if (res === 'upgraded') {
                        return res;
                    }
                } catch (err: any) {
                    const errorHandler = ctx.get(key.request.errorHandler);
                    const r = errorHandler.render(err);
                    res = r instanceof Promise ? await r : r;
                }
                return res instanceof Blob ? new Response(res) : res;
            };

            let res = await next();

            if (res === 'upgraded') {
                setImmediate(() => ctx.emit('upgraded', ctx));
                return;
            }

            const setres = (r: Response) => (res = r);

            const finisher = ctx.listeners('finishing');

            for (const finish of finisher) {
                const val = finish(ctx, res as Response, setres);
                if (val instanceof Promise) {
                    await val;
                }
            }

            setImmediate(() => ctx.emit('finished', ctx, res as Response));
            return res;
        } catch (err: any) {
            const errorHandler = ctx.get(key.request.errorHandler);
            return errorHandler.render(err);
        }
    }

    eventNames() {
        return ['resolved', 'request'];
    }
}
