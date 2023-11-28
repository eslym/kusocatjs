import { type Writable, writable, get } from 'svelte/store';
import { router } from '@inertiajs/core';
import { useStateKey } from './state-key';

type NonFunction = string | number | bigint | boolean | null | undefined | symbol | object;

export function useRemember<T extends NonFunction>(
    initial: T | (() => T),
    key?: string,
): Writable<T> {
    const restored = router.restore(key) as T;

    const state = useStateKey();
    const init = typeof initial === 'function' ? initial : () => initial;

    const base = writable<T>(restored === undefined ? init() : restored, set => {
        return state.subscribe(() => {
            const restored = router.restore(key) as T;
            set(restored === undefined ? init() : restored);
        });
    });

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
