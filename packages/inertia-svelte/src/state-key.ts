import { derived } from 'svelte/store';
import { useStore } from './store';

export function useStateKey() {
    const base = useStore();
    let s: number | undefined = undefined;
    return derived(base, ($store, set: (value: number) => void) => {
        if ($store.key !== s) {
            set((s = $store.key!));
        }
    });
}
