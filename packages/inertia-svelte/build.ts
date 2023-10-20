///<reference types="bun-types"/>

import type { BunPlugin } from 'bun';
import { type PreprocessorGroup, preprocess } from 'svelte/compiler';

import { dependencies } from './package.json';
import { dirname, join, resolve } from 'path';
import { glob } from 'glob';
import { mkdir, rmdir } from 'fs/promises';

const external = Object.keys(dependencies);

const store = resolve(import.meta.dir, './src/store.ts');
const dist = resolve(import.meta.dir, './dist');
const src = resolve(import.meta.dir, './src');

await rmdir(dist, { recursive: true });
await mkdir(dist);

const transpile: PreprocessorGroup = {
    async script({ content, attributes }) {
        if (attributes.lang !== 'ts') return;
        const transpiler = new Bun.Transpiler({
            loader: 'ts',
            trimUnusedImports: false,
            deadCodeElimination: false,
        });
        const code = await transpiler.transform(content);
        const attr = Object.assign({}, attributes);
        delete attr.lang;
        return { code, attributes: attr };
    },
};

const files = await glob('*.svelte', { cwd: src });

console.time('preprocess');
await Promise.all(
    files.map(async file => {
        const content = await Bun.file(resolve(src, file)).text();
        const { code } = await preprocess(content, transpile, { filename: file });
        const path = resolve(dist, file);
        await Bun.write(path, code);
    }),
);
console.timeEnd('preprocess');

const shared: BunPlugin = {
    name: 'shared',
    setup(build) {
        build.onResolve({ filter: /^/ }, ({ path, importer }) => {
            const file = resolve(dirname(importer), path);
            if (file === store.replace(/\.[^.]+$/, '')) {
                return {
                    path: join(dist, 'store.js'),
                    external: true,
                };
            }
        });
    },
};

const svelte: BunPlugin = {
    name: 'svelte',
    setup(build) {
        build.onResolve({ filter: /\.svelte$/ }, async ({ path, importer }) => {
            const file = resolve(dirname(importer), path);
            if (await Bun.file(file).exists()) {
                return {
                    path: file,
                    external: true,
                };
            }
        });
    },
};

console.time('build shared');
const sharedBuild = await Bun.build({
    entrypoints: [store],
    outdir: resolve(import.meta.dir, './dist'),
    plugins: [svelte, shared],
    target: 'browser',
    external,
});
console.timeEnd('build shared');
console.log(...sharedBuild.logs);

console.time('build frontend');
const frontend = await Bun.build({
    entrypoints: [resolve(import.meta.dir, './src/index.ts')],
    outdir: dist,
    plugins: [svelte, shared],
    target: 'browser',
    external,
});
console.timeEnd('build frontend');
console.log(...frontend.logs);

console.time('build ssr');
const backend = await Bun.build({
    entrypoints: [resolve(import.meta.dir, './src/ssr.ts')],
    outdir: dist,
    plugins: [svelte, shared],
    target: 'bun',
    external,
});
console.timeEnd('build ssr');
console.log(...backend.logs);
