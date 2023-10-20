import type { Page, PageProps } from '@inertiajs/core';
import {
    RedirectError,
    type RequestContext,
    createContextKey,
    key,
    defaultErrorHandler,
    type ContextInterface,
    type ErrorHandlerInterface,
    HTTPError,
} from '@kusocat/core';

export type RenderInertia = (
    page: Omit<Page, 'scrollRegions' | 'rememberedState'>,
) => Promise<string>;

export type RenderToTemplate = (
    template: string,
    ...args: Parameters<RenderInertia>
) => Promise<string>;

export interface InertiaInterface {
    readonly isInertia: boolean;
    version(version: string): this;
    share(key: string, value: any): this;
    render(
        component: string,
        props?: PageProps,
        options?: ResponseInit & { ignoreInertia?: boolean },
    ): Promise<Response>;
    location(url: string | URL): Promise<Response>;
}

function conflict(request: Request, version: string | null = null) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
    }
    return request.headers.get('X-Inertia-Version') !== version;
}

export class Inertia implements InertiaInterface {
    #ctx: ContextInterface;
    #request: Request;
    #version: string | undefined;
    #shared: Map<string, any> = new Map();
    #render: RenderInertia;

    get isInertia() {
        return this.#request.headers.get('X-Inertia') === 'true';
    }

    constructor(ctx: ContextInterface, request: Request, render: RenderInertia) {
        this.#ctx = ctx;
        this.#request = request;
        this.#render = render;
    }

    version(version: string) {
        this.#version = version;
        return this;
    }

    share(key: string, value: any) {
        this.#shared.set(key, value);
        return this;
    }

    async render(
        component: string,
        props: PageProps = {},
        options?: ResponseInit & { ignoreInertia?: boolean },
    ) {
        const request = this.#request;
        const headers = new Headers(options?.headers);
        headers.set('cache-control', 'no-cache, private');
        options = {
            status: 200,
            ...options,
            headers,
        };
        if (options.ignoreInertia || !this.isInertia) {
            const page = JSON.parse(JSON.stringify(await this.#collectProps(this.#shared, props)));
            const html = await this.#render({
                component,
                props: page,
                version: this.#version ?? null,
                url: request.url,
            });
            headers.set('Content-Type', 'text/html');
            headers.set('Content-Length', Buffer.byteLength(html).toString());
            return new Response(html, options);
        }
        headers.set('X-Inertia', 'true');
        if (conflict(request, this.#version)) {
            headers.set('X-Inertia-Location', request.url);
            return new Response(null, {
                status: 409,
                headers,
            });
        }
        let only: Set<string> | undefined = undefined;
        const partialComponent = request.headers.get('X-Inertia-Partial-Component');
        const partialData = request.headers.get('X-Inertia-Partial-Data');
        if (partialData && partialComponent === component) {
            only = new Set(partialData.split(',').map(key => key.trim()));
        }
        const page = JSON.parse(
            JSON.stringify(await this.#collectProps(this.#shared, props, only)),
        );
        return Response.json(
            {
                component,
                props: page,
                url: request.url,
                version: this.#version ?? null,
            },
            options,
        );
    }

    async location(url: string | URL) {
        if (this.isInertia) {
            return new Response(null, {
                status: 409,
                headers: {
                    'X-Inertia-Location': url.toString(),
                },
            });
        }
        throw new RedirectError(url.toString());
    }

    async #collectProps(shared: Map<string, any>, props: Record<string, any>, only?: Set<string>) {
        const result: any = {
            errors: {},
        };
        if (this.#ctx.resolved(key.request.session)) {
            const session = await this.#ctx.get(key.request.session);
            if (session.has('errors')) {
                result.errors = session.get('errors');
            }
        }
        const final = new Map([...shared, ...Object.entries(props)]);
        for (const [key, value] of final) {
            if (key !== 'errors' && only && !only.has(key)) continue;
            if (typeof value === 'function') {
                result[key] = await value();
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    static handle(component: string, props?: PageProps, options?: ResponseInit) {
        return async (ctx: RequestContext) => {
            const inertia = ctx.get(Inertia.inertiaContext);
            return inertia.render(component, props, options);
        };
    }

    static create(ctx: ContextInterface) {
        const render = ctx.get(key.app).get(Inertia.renderContext);
        const request = ctx.get(key.request);
        return new Inertia(ctx, request, render);
    }

    static renderContext = createContextKey<RenderInertia>('inertia.render');
    static inertiaContext = createContextKey<InertiaInterface>('inertia.instance');
}

const shoundIntercept = new Set(['PUT', 'PATCH', 'DELETE']);

export async function handleInertia(
    ctx: RequestContext,
    next: () => Promise<Response | 'upgraded'>,
) {
    const res = await next();
    if (
        res === 'upgraded' ||
        res.status !== 302 ||
        !shoundIntercept.has(ctx.get(key.request).method)
    )
        return res;
    const inertia = ctx.get(Inertia.inertiaContext);
    if (!inertia.isInertia) return res;
    return new Response(res.body, {
        status: 303,
        headers: res.headers,
    });
}

export abstract class InertiaErrorHandler implements ErrorHandlerInterface {
    #inertia: InertiaInterface;

    constructor(inertia: InertiaInterface) {
        this.#inertia = inertia;
    }

    async render(error: Error): Promise<Response> {
        try {
            return await this.#render(error);
        } catch (e: any) {
            return defaultErrorHandler.render(e);
        }
    }

    #render(error: Error): Promise<Response> {
        const com = this.resolveComponent(error);
        let component: string;
        let props: PageProps;
        if (typeof com === 'string') {
            component = com;
            props =
                process.env.NODE_ENV === 'production'
                    ? {
                          _stack: error.stack,
                      }
                    : {};
        } else {
            component = com.component;
            props = com.props;
        }
        if (error instanceof HTTPError) {
            props.message = props.message ?? error.message;
            props.status = props.status ?? error.status;
            return this.#inertia.render(component, props, {
                status: error.status,
                headers: error.headers,
            });
        }
        props.message =
            props.message ?? process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : error.message;
        props.status = props.status ?? 500;
        if (process.env.NODE_ENV !== 'production') {
            props.stack = error.stack;
        }
        return this.#inertia.render(component, props, {
            status: 500,
        });
    }

    abstract resolveComponent(error: Error): string | { component: string; props: PageProps };
}
