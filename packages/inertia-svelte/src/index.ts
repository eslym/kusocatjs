import { type Page, router, setupProgress } from '@inertiajs/core';
import type { ComponentType, SvelteComponent } from 'svelte';
import { browserStore } from './store';
import App from './App.svelte';

export { useForm } from './form';
export { usePage } from './page';
export { useRemember } from './remember';
export { link } from './link';

export interface CreateAppOptions {
    target?: string | HTMLElement;
    resolve: ResolveComponent;
    page?: Page;
    progress?: Parameters<typeof setupProgress>[0];
    hydrate?: boolean;
}

export interface SveltePageComponentModule {
    default: ComponentType;
    layout?: ComponentType | ComponentType[];
}

type Awaitable<T> = T | Promise<T>;

export type ResolveComponent = (name: string) => Awaitable<SveltePageComponentModule>;

export function createInertiaApp(options: CreateAppOptions): SvelteComponent {
    const target: HTMLElement =
        typeof options.target === 'string'
            ? document.querySelector(options.target)!
            : options.target || document.getElementById('app')!;

    const page: Page = options.page || JSON.parse(target.dataset.page!);
    const resolve = (name: string) => Promise.resolve(options.resolve(name));
    resolve(page.component).then(module => {
        browserStore.set({
            component: module.default,
            layout: module.layout,
            page,
        });
    });

    router.init({
        initialPage: page,
        resolveComponent: resolve,
        swapComponent: async ({ component, page }) => {
            const { default: com, layout } = component as SveltePageComponentModule;
            browserStore.set({
                component: com,
                layout: layout,
                page,
            });
        },
    });

    if (options.progress) setupProgress(options.progress);

    return new App({
        target,
        hydrate: options.hydrate,
    });
}
