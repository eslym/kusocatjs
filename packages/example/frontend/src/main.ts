import { createInertiaApp } from '@kusocat/inertia-svelte';
import { resolvePage } from './resolve';

export const app = createInertiaApp({
    target: document.body,
    resolve: resolvePage,
    page: (window as any).__initialPage,
    hydrate: true,
});
