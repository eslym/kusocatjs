import type { Page } from '@inertiajs/core';
import type { ResolveComponent } from './index';
import { readable } from 'svelte/store';
import { contextKey } from './store';
import App from './App.svelte';

export interface SSRRenderResult {
    html: string;
    css: {
        code: string;
        map: string | null;
    };
    head: string;
}

interface SvelteSSRComponent {
    render(props: Record<string, any>, options: { context: Map<any, any> }): SSRRenderResult;
}

export function createSSRRender(
    resolve: ResolveComponent,
): (page: Omit<Page, 'scrollRegions' | 'rememberedState'>) => Promise<SSRRenderResult> {
    return async page => {
        const module = await resolve(page.component);
        const store = readable({
            component: module.default,
            layout: module.layout,
            page,
            key: performance.now(),
        });
        const context = new Map([[contextKey, store]]);
        return (App as any as SvelteSSRComponent).render({}, { context });
    };
}
