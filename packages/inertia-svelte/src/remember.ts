import { type Writable, writable, get } from 'svelte/store';
import { router } from '@inertiajs/core';

export function useRemember<T>(initialState: T, key?: string): Writable<T> {
    const restored = router.restore(key) as T;
    const base = writable<T>(restored === undefined ? initialState : restored);

    function set(val: T) {
        router.remember(val, key);
        base.set(val);
    }

    function update(updater: (val: T) => T) {
        set(updater(get(base)));
    }

    return {
        subscribe: base.subscribe,
        set,
        update,
    };
}
