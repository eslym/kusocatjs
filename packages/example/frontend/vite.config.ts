import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';

// https://vitejs.dev/config/
export default defineConfig({
    //@ts-ignore somehow got incompatible types
    plugins: [svelte()],
    resolve: {
        alias: {
            $src: fileURLToPath(new URL('./src', import.meta.url)),
            $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
            $components: fileURLToPath(new URL('./src/lib/components', import.meta.url)),
            $layouts: fileURLToPath(new URL('./src/layouts', import.meta.url)),
        },
    },
    server: {
        fs: {
            allow: ['.', '../node_modules', '../../../node_modules'],
        },
    },
});
