import { minimatch } from 'minimatch';
import type { MiddlewareFunction } from './router';
import { key } from './context';
import { resolve } from 'path';
import { stat, exists } from 'fs/promises';

export interface StaticMiddlewareOptions {
    exclude?: string | string[];
    headers?: HeadersInit;
}

export function staticFiles(
    root: string,
    options: StaticMiddlewareOptions = {},
): MiddlewareFunction {
    const ignoreList =
        typeof options.exclude === 'string'
            ? [options.exclude]
            : options.exclude
            ? options.exclude
            : [];
    const ignored = new Set<string>();
    return async (ctx, next) => {
        const req = ctx.get(key.request);
        const url = new URL(req.url);
        const pathname = decodeURI(url.pathname).replace(/^\//, '');
        const path = resolve(root, pathname);
        if (!(await exists(path))) return next();
        const file = await stat(path);
        if (!file.isFile()) return next();
        if (ignored.has(pathname)) return next();
        for (const pattern of ignoreList) {
            if (minimatch(pathname, pattern)) {
                ignored.add(pathname);
                return next();
            }
        }
        return new Response(Bun.file(path), {
            headers: options.headers,
        });
    };
}
