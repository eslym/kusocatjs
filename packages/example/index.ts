import { app } from '$app/app';
import { staticFiles } from '@kusocat/core/middleware';
import { dirname, join } from 'path';
import { render } from 'frontend/server';
import { Inertia } from '@kusocat/inertia';

const client = import.meta.resolveSync('frontend/client');
const server = import.meta.resolveSync('frontend/server');
const manifest = join(dirname(server), 'ssr-manifest.json');
const version = Bun.SHA1.hash(await Bun.file(manifest).arrayBuffer(), 'hex');
const template = await Bun.file(client).text();

app.set(
    Inertia.renderContext,
    async page => {
        return render(template, page);
    },
    true,
).use(
    staticFiles(dirname(client), {
        exclude: '/index.html',
        headers: {
            'cache-control': 'public, max-age=14400',
        },
    }),
    true,
);

app.on('request', ctx => {
    ctx.resolved(Inertia.inertiaContext, inertia => inertia.version(version));
});

app.serve({
    hostname: '0.0.0.0',
    port: 3000,
});

console.log('Listening on http://localhost:3000');

export { app };
