<script lang="ts">
    import Render from './Render.svelte';
    import type { Writable } from 'svelte/store';
    import type { RenderContext } from './store';
    import { setContext } from 'svelte';
    import { contextKey, useStore } from './store';

    const store: Writable<RenderContext> = useStore();

    setContext(contextKey, store);
</script>

{#if $store.component}
    <Render component={$store.component} props={$store.page?.props} state={$store.key} />
{/if}
