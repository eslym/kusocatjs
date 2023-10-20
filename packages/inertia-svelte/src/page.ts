import { derived, type Readable, type Writable } from 'svelte/store';
import type { Page, PageProps } from '@inertiajs/core';
import { useStore, type RenderContext } from './store';

export function usePage<Props extends PageProps = PageProps>(): Readable<Page<Props>> {
    const base: Writable<RenderContext> = useStore();
    return derived(base, $store => $store.page!) as any;
}
