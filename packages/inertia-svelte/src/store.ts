import { getContext, type ComponentType } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import type { Page } from '@inertiajs/core';

export interface RenderContext {
    component?: ComponentType;
    layout?: ComponentType | ComponentType[];
    page?: Page;
}

export const browserStore = writable<RenderContext>({});

export const contextKey = Symbol('inertia-render-context');

export function useStore(): Writable<RenderContext> {
    return getContext(contextKey) ?? browserStore;
}
