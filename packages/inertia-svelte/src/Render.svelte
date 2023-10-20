<script lang="ts">
    import type { ComponentType } from 'svelte';

    export let components: ComponentType[];
    export let props: any;

    $: first = components[0];

    $: rest = components.slice(1);
</script>

{#if rest.length}
    <svelte:component this={first} {...props}>
        <svelte:self components={rest} {props} />
    </svelte:component>
{:else}
    <svelte:component this={first} {...props}></svelte:component>
{/if}
