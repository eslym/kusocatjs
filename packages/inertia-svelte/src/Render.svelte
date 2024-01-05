<script lang="ts" context="module">
    import type { ComponentType } from 'svelte';

    const componentKeys = new Map<ComponentType, string>();

    function getComponentKey(component: ComponentType) {
        if (!componentKeys.has(component)) {
            componentKeys.set(
                component,
                Math.floor(performance.now() * 1e12).toString(36) +
                    '-' +
                    Math.floor(Math.random() * 1e12).toString(36),
            );
        }

        return componentKeys.get(component);
    }
</script>

<script lang="ts">
    import type { SveltePageComponentModule } from './index';

    export let component: SveltePageComponentModule;
    export let props: any;

    export let state: number | undefined = undefined;

    let layout: SveltePageComponentModule | undefined = undefined;

    $: Promise.resolve(component.layout).then(l => (layout = l));

    $: key =
        ('preserveState' in component && component.preserveState) || !('preserveState' in component)
            ? getComponentKey(component.default)
            : state;
</script>

{#if component.layout}
    {#if layout}
        <svelte:self component={layout} {props}>
            {#key key}
                <svelte:component this={component.default} {...props}>
                    <slot />
                </svelte:component>
            {/key}
        </svelte:self>
    {/if}
{:else}
    {#key key}
        <svelte:component this={component.default} {...props}>
            <slot />
        </svelte:component>
    {/key}
{/if}
