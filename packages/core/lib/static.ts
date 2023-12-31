import { minimatch } from 'minimatch';
import type { MiddlewareFunction } from './router';
import { key } from './context';
import { resolve } from 'path';
import { stat, exists } from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

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
    const cachedHeaders = new Map<string, Headers>();
    return async (ctx, next) => {
        const req = ctx.get(key.request);
        const url = new URL(req.url);
        const pathname = decodeURI(url.pathname).replace(/^\//, '');
        const path = resolve(root, pathname);
        if (!cachedHeaders.has(path)) {
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

            const headers = new Headers(options.headers);
            if (file.mtimeMs) {
                headers.set('Last-Modified', new Date(file.mtimeMs).toUTCString());
            }
            if (file.size) {
                headers.set('Content-Length', file.size.toString());
            }
            headers.set('Content-Type', Bun.file(path).type);
            cachedHeaders.set(path, headers);
        }
        const headers = cachedHeaders.get(path)!;

        if (req.headers.has('if-modified-since')) {
            const ifModifiedSince = new Date(req.headers.get('if-modified-since')!);
            const mtime = new Date(headers.get('Last-Modified')!);
            if (ifModifiedSince >= mtime) {
                return new Response(null, { status: 304, headers });
            }
        }

        // Bun.file is not stable, so we use fs.createReadStream instead
        // TODO: use Bun.file when it's stable
        const stream = createReadStream(path);
        return new Response(Readable.toWeb(stream) as ReadableStream, {
            headers,
        });
    };
}
