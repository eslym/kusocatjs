import { type Page, router, setupProgress } from '@inertiajs/core';
import type { ComponentType, SvelteComponent } from 'svelte';
import { browserStore } from './store';
import App from './App.svelte';

export { useForm } from './form';
export { usePage } from './page';
export { useRemember } from './remember';
export { useStateKey } from './state-key';
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
    layout?: Promise<SveltePageComponentModule>;
}

type Awaitable<T> = T | Promise<T>;

export type ResolveComponent = (name: string) => Awaitable<SveltePageComponentModule>;

/**
 * A noop function which can used for svelte reactive statements.
 *
 * ```svelte
 * <script>
 *     import { noop } from '@inertiajs/inertia-svelte';
 *     const createForm = useForm(() => user);
 *     // recreate the form on user changed
 *     $: f = noop(user.id) ?? createForm();
 *     $: form = f.form;
 *     $: data = f.data;
 *     $: errors = f.errors;
 * </script>
 * ```
 */
export const noop: (...args: any[]) => unknown = () => {};

export function createInertiaApp(options: CreateAppOptions): SvelteComponent {
    const target: HTMLElement =
        typeof options.target === 'string'
            ? document.querySelector(options.target)!
            : options.target || document.getElementById('app')!;

    const page: Page = options.page || JSON.parse(target.dataset.page!);
    const resolve = (name: string) => Promise.resolve(options.resolve(name));
    resolve(page.component).then(module => {
        browserStore.set({
            component: module as SveltePageComponentModule,
            page,
            key: performance.now(),
        });
    });

    router.init({
        initialPage: page,
        resolveComponent: resolve,
        swapComponent: async ({ component, page, preserveState }) => {
            browserStore.update(({ key }) => ({
                component: component as SveltePageComponentModule,
                page,
                key: preserveState ? key : performance.now(),
            }));
        },
    });

    if (options.progress) setupProgress(options.progress);

    return new App({
        target,
        hydrate: options.hydrate,
    });
}
