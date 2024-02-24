<script lang="ts" context="module">
    import type { ComponentType } from 'svelte';
    import type { SveltePageComponentModule } from './index';

    const componentKeys = new Map<ComponentType, string>();

    const layouts = new WeakMap<Promise<SveltePageComponentModule>, SveltePageComponentModule>();

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
    export let component: SveltePageComponentModule;
    export let props: any;

    export let state: number | undefined = undefined;

    let layout: SveltePageComponentModule | undefined = undefined;

    $: if (component.layout instanceof Promise) {
        if (layouts.has(component.layout)) {
            layout = layouts.get(component.layout);
        } else {
            const promise = component.layout;
            layout = undefined;
            promise.then(com => {
                layouts.set(promise, com);
                layout = com;
            });
        }
    } else {
        layout = component.layout;
    }

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
