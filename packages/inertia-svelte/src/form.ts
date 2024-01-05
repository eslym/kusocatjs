import { router, type Method, type VisitOptions } from '@inertiajs/core';
import { writable, type Writable, type Readable } from 'svelte/store';
import type { AxiosProgressEvent } from 'axios';
import isEqual from 'lodash.isequal';
import cloneDeep from 'lodash.clonedeep';

const formKey = '__inertia_form_data';

interface FormState {
    readonly dirty: boolean;
    readonly processing: boolean;
    readonly success?: boolean;
}

interface State {
    dirty: boolean;
    processing: boolean;
    progress?: AxiosProgressEvent;
    success?: boolean;
}

interface RememberState<T extends Record<string, any>> {
    state: Pick<State, 'dirty' | 'success'>;
    data: T;
    errors: Record<string, string[]>;
}

interface FormController<T extends Record<string, any>> extends Readable<FormState> {
    reset(...fields: string[]): this;

    defaults(data: T): this;

    defaults(): T;

    transform(transformer: (data: T) => any): this;

    submit(method: Method, url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    error(key: string, errors: string | string[], append?: boolean): this;

    clearErrors(...keys: string[]): this;

    cancel(): this;
}

interface UseForm<Data extends Record<string, any>> {
    form: FormController<Data>;
    data: Writable<Data>;
    errors: Readable<Record<string, string[]>>;
}

function value<T>(value: T, notifier: (val: T) => void) {
    return {
        get value() {
            return value;
        },
        set value(val) {
            value = val;
            notifier(val);
        },
    };
}

export function useForm<T extends Record<string, any>>(data: T, rememberKey?: string): UseForm<T>;
export function useForm<T extends Record<string, any> = Record<string, any>>(
    rememberKey?: string,
): UseForm<T>;
export function useForm<T extends Record<string, any> = {}>(
    dataOrRememberKey?: T | string,
    rememberKey?: string,
): UseForm<T> {
    const key =
        typeof dataOrRememberKey === 'string'
            ? formKey + ':' + (dataOrRememberKey ?? 'default')
            : formKey + ':' + (rememberKey ?? 'default');
    let defaults: T = cloneDeep(
        typeof dataOrRememberKey === 'object' ? dataOrRememberKey : {},
    ) as any;
    let state: RememberState<T> = (router.restore(key) as any) || {
        state: {
            dirty: false,
        },
        data: cloneDeep(defaults),
        errors: {},
    };
    let transform: (data: T) => any = data => data;
    let cancelToken: { cancel(): void } | undefined = undefined;
    let errorsStore = writable(state.errors);
    let processing = value(false, () => stateStore.set(stateAccessor));
    let progress = value<AxiosProgressEvent | undefined>(undefined, () =>
        stateStore.set(stateAccessor),
    );
    const stateAccessor: State = {
        get dirty() {
            return state.state.dirty;
        },
        get processing() {
            return processing.value;
        },
        get progress() {
            return progress.value;
        },
        get success() {
            return state.state.success;
        },
    };
    const baseDataStore = writable(state.data);
    const stateStore = writable(stateAccessor);

    function updateState<T extends keyof (typeof state)['state']>(
        key: T,
        value: (typeof state)['state'][T],
    ) {
        if (state.state[key] === value) return;
        state.state[key] = value;
        stateStore.set(stateAccessor);
        router.remember(state, key);
    }

    function setData(data: T) {
        baseDataStore.set((state.data = data));
        const dirty = !isEqual(data, defaults);
        if (dirty !== state.state.dirty) {
            updateState('dirty', dirty);
        }
        router.remember(state, key);
    }

    function updateData(updater: (data: T) => T) {
        setData(updater(state.data));
    }

    const form: FormController<T> = {
        subscribe: stateStore.subscribe,
        reset(...fields) {
            if (!fields.length) {
                setData(cloneDeep(defaults));
                return this;
            }
            for (const field of fields) {
                if (field in defaults) {
                    (state.data as any)[field] = cloneDeep(defaults[field]);
                } else {
                    (state.data as any)[field] = undefined;
                }
            }
            setData(state.data);
            return this;
        },
        defaults: function (this: FormController<T>, data?: T) {
            if (!data) return defaults;
            defaults = cloneDeep(data);
            updateState('dirty', !isEqual(state.data, defaults));
            return this;
        } as any,
        error(key: string, errors: string | string[], append = false) {
            const err = state.errors[key] || [];
            if (typeof errors === 'string') {
                errors = [errors];
            }
            if (append) {
                errors = err.concat(errors);
            }
            state.errors[key] = errors;
            errorsStore.set(state.errors);
            router.remember(state, key);
            return this;
        },
        clearErrors(...keys) {
            if (!keys.length) {
                state.errors = {};
                errorsStore.set(state.errors);
                router.remember(state, key);
                return this;
            }
            for (const key of keys) {
                delete state.errors[key];
            }
            errorsStore.set(state.errors);
            router.remember(state, key);
            return this;
        },
        transform(transformer) {
            transform = transformer;
            return this;
        },
        submit(method, url, options = {}) {
            const opt: VisitOptions = {
                method,
                ...options,
                onCancelToken: token => {
                    cancelToken = token;
                    options.onCancelToken?.(token);
                },
                onBefore: visit => {
                    updateState('success', undefined);
                    return options.onBefore?.(visit);
                },
                onStart: visit => {
                    processing.value = true;
                    options.onStart?.(visit);
                },
                onProgress: event => {
                    progress.value = event;
                    options.onProgress?.(event);
                },
                onSuccess: page => {
                    errorsStore.set((state.errors = {}));
                    router.remember(state, key);
                    updateState('success', true);
                    options.onSuccess?.(page);
                },
                onError: errors => {
                    errorsStore.set(
                        (state.errors = Object.fromEntries(
                            Object.entries(errors).map(([k, v]) => [
                                k,
                                typeof v === 'string' ? [v] : v,
                            ]),
                        )),
                    );
                    router.remember(state, key);
                    updateState('success', false);
                    options.onError?.(errors);
                },
                onFinish: visit => {
                    processing.value = false;
                    options.onFinish?.(visit);
                },
                data: transform(cloneDeep(state.data)),
            };
            router.visit(url, opt);
        },
        cancel() {
            if (cancelToken) {
                cancelToken.cancel();
                cancelToken = undefined;
            }
            return this;
        },
    };

    return {
        form,
        data: {
            subscribe: baseDataStore.subscribe,
            set: setData,
            update: updateData,
        },
        errors: {
            subscribe: errorsStore.subscribe,
        },
    };
}
