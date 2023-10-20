import type { SveltePageComponentModule } from '@kusocat/inertia-svelte';

const pages = import.meta.glob('./pages/**/*.svelte');

export function resolvePage(path: string): Promise<SveltePageComponentModule> {
    if (!pages[`./pages/${path}.svelte`]) {
        throw new Error(`Component ${path} not found`);
    }
    return pages[`./pages/${path}.svelte`]() as any;
}
