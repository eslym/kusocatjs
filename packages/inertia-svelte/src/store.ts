import { getContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import type { Page } from '@inertiajs/core';
import type { SveltePageComponentModule } from './index';

export interface RenderContext {
    component?: SveltePageComponentModule;
    page?: Page;
    key?: number;
}

export const browserStore = writable<RenderContext>({});

export const contextKey = Symbol('inertia-render-context');

export function useStore(): Writable<RenderContext> {
    return getContext(contextKey) ?? browserStore;
}
