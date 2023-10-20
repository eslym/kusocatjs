<script lang="ts">
    import Render from './Render.svelte';
    import type { Writable } from 'svelte/store';
    import type { RenderContext } from './store';
    import { setContext } from 'svelte';
    import { contextKey, useStore } from './store';

    const store: Writable<RenderContext> = useStore();

    setContext(contextKey, store);

    $: components = Array.isArray($store.layout)
        ? [...$store.layout, $store.component!]
        : $store.layout
        ? [$store.layout, $store.component!]
        : [$store.component!];
</script>

{#if $store.component}
    <Render {components} props={$store.page?.props} />
{/if}
