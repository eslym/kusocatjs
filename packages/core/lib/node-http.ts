import { IncomingMessage, ServerResponse } from 'http';
import { createContextKey } from './context';
import type { MiddlewareFunction } from './router';
import type { RequestContext } from './app';

type HttpHandler = (
    ctx: RequestContext,
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: any) => void,
) => void;

const httpRequest = createContextKey<IncomingMessage>('node-http.request');
const httpResponse = createContextKey<ServerResponse>('node-http.response');

const env = process.env;

export const nodeHttp = Object.assign(
    (handler: HttpHandler) => {
        if (env.NODE_ENV === 'production') {
            console.warn('node-http middleware is not recommended for production use');
        }
        return ((ctx: RequestContext, next) => {
            if (ctx.has(httpRequest)) {
                throw new Error('node-http middleware can only be used once per request');
            }

            let pendingResponse: Response | 'upgraded' | undefined;
            let pendingError: Error | undefined;

            let resolve: (response: Response | 'upgraded') => void;
            let reject: (error: Error) => void;

            function raise(err: any) {
                if (pendingError) return;
                reject?.((pendingError = err));
            }

            function respond(res: Response | 'upgraded') {
                if (pendingResponse) return;
                resolve?.((pendingResponse = res ?? 'upgraded'));
            }

            // need to use the RequestContext.request insteand of get(context.request)
            // since context.request is mutable and might not be the original request
            const req = new IncomingMessage(ctx.request as any);
            const res = new ServerResponse({ req, reply: respond } as any);

            req.once('error', raise);
            res.once('error', raise);

            ctx.set(httpRequest, req, true);
            ctx.set(httpResponse, res, true);

            const promise = new Promise<Response | 'upgraded'>((res, rej) => {
                resolve = res;
                reject = rej;
            });

            handler(ctx, req, res, (err?: any) => {
                if (err) return raise(err);
                Promise.resolve(next()).then(respond, raise);
            });

            return promise;
        }) as MiddlewareFunction;
    },
    {
        request: httpRequest,
        response: httpResponse,
    },
);
