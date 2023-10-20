import { key } from './lib/context.ts';
import type { MiddlewareFunction } from './lib/router.ts';

export * from './lib/trustedproxy.ts';
export * from './lib/node-http.ts';
export * from './lib/static.ts';

export const setCookies: MiddlewareFunction = async (ctx, next) => {
    const res = await next();
    if (res === 'upgraded' || !ctx.resolved(key.request.cookies)) return res;
    const cookies = await ctx.get(key.request.cookies);
    for (const header of cookies.headers()) {
        res.headers.append('Set-Cookie', header);
    }
    return res;
};

export const commitSession: MiddlewareFunction = async (ctx, next) => {
    const res = await next();
    if (res === 'upgraded' || !ctx.resolved(key.request.session)) return res;
    await ctx.get(key.request.session).then(s => s.commit());
    return res;
};
