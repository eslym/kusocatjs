import { createServer } from 'vite';
import { join } from 'path';
import { EventEmitter } from 'events';
import { nodeHttp } from '@kusocat/core/middleware';
import { app } from './app/app';
import { RenderInertia, Inertia } from '@kusocat/inertia';
import { readFile } from 'fs/promises';

const fakeServer = new EventEmitter();
const vite = await createServer({
    root: join(import.meta.dir, 'frontend'),
    configFile: join(import.meta.dir, 'frontend/vite.config.ts'),
    server: {
        hmr: {
            server: fakeServer as any,
        },
        middlewareMode: true,
    },
    appType: 'custom',
});

const renderInertia: RenderInertia = async page => {
    const { render } = await vite.ssrLoadModule('/src/ssr.ts', { fixStacktrace: true });
    const template = await vite.transformIndexHtml(
        page.url,
        await readFile(new URL('./frontend/index.html', import.meta.url), 'utf-8'),
    );
    return render(template, page);
};

app.set(Inertia.renderContext, renderInertia, true);

let bunternal = (socket: any) => {
    for (const prop of Object.getOwnPropertySymbols(socket)) {
        if (prop.toString().includes('bunternal')) {
            bunternal = () => prop;
            return prop as any;
        }
    }
};

app.use(
    nodeHttp((ctx, req, res, next) => {
        if (
            ctx.request.headers.get('upgrade') &&
            ctx.request.headers.get('sec-websocket-protocol') === 'vite-hmr'
        ) {
            const socket = req.socket as any;
            socket[bunternal(socket)] = [ctx.server, res, ctx.request];
            fakeServer.emit('upgrade', req, socket, Buffer.alloc(0));
            return;
        }
        vite.middlewares(req, res, (err?: any) => {
            if (err) {
                vite.ssrFixStacktrace(err);
            }
            next(err);
        });
    }),
    true,
);

app.serve({
    port: 5173,
});

console.log('Listening on http://localhost:5173');

export { app };
