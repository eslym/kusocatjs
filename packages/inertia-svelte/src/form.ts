import { router, type Method, type VisitOptions } from '@inertiajs/core';
import { writable, type Writable, type Readable, get } from 'svelte/store';
import type { AxiosProgressEvent } from 'axios';
import isEqual from 'lodash.isequal';
import cloneDeep from 'lodash.clonedeep';
import { onMount } from 'svelte';
import { useRemember } from './remember';

const formKey = '__inertia_form_data';

interface FormState {
    readonly dirty: boolean;
    readonly processing: boolean;
    readonly success?: boolean;
    readonly progress?: AxiosProgressEvent;
}

interface State {
    dirty: boolean;
    processing: boolean;
    progress?: AxiosProgressEvent;
    success?: boolean;
}

interface RememberState<T extends Record<string, any>> {
    success?: boolean;
    data: T;
    defaults: T;
    errors: Record<string, string[]>;
}

interface FormController<T extends Record<string, any>> extends Readable<FormState> {
    reset(...fields: string[]): this;

    defaults(data: T): this;

    defaults(): T;

    transform(transformer: (data: T) => any): this;

    submit(method: Method, url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    post(url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    put(url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    patch(url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    delete(url: string, options?: Omit<VisitOptions, 'method' | 'data'>): void;

    error(key: string, errors: string | string[], append?: boolean): this;

    clearErrors(...keys: string[]): this;

    restore(): this;

    cancel(): this;
}

interface UseForm<Data extends Record<string, any>> {
    form: FormController<Data>;
    data: Writable<Data>;
    errors: Readable<Record<string, string[]>>;
}

function touch<T>(cb: (data: T) => void): (data: T) => T {
    return (data: T) => {
        cb(data);
        return data;
    };
}

export function useForm<T extends Record<string, any>>(
    data: T | (() => T),
    rememberKey?: string,
): UseForm<T>;
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
    const init =
        typeof dataOrRememberKey === 'function'
            ? dataOrRememberKey
            : typeof dataOrRememberKey === 'object'
              ? () => dataOrRememberKey
              : () => ({}) as T;

    const rememberStore = useRemember<RememberState<T>>(
        () => ({
            data: cloneDeep(init()),
            defaults: cloneDeep(init()),
            errors: {},
        }),
        key,
    );

    const dataStore = writable<T>({} as T);
    const defaultsStore = writable<T>({} as T);
    const errorsStore = writable<Record<string, string[]>>({});
    const formStateStore = writable<State>({
        dirty: false,
        processing: false,
    });

    function syncDirty($data: T, $defaults: T) {
        const state = get(formStateStore);
        const dirty = !isEqual($data, $defaults);
        if (state.dirty !== dirty) {
            state.dirty = dirty;
            formStateStore.set(state);
        }
    }

    onMount(() =>
        dataStore.subscribe($data => {
            syncDirty($data, get(defaultsStore));
            rememberStore.update(touch(state => (state.data = $data)));
        }),
    );

    onMount(() =>
        defaultsStore.subscribe($defaults => {
            syncDirty(get(dataStore), $defaults);
            rememberStore.update(touch(state => (state.defaults = $defaults)));
        }),
    );

    onMount(() =>
        errorsStore.subscribe($errors =>
            rememberStore.update(touch(state => (state.errors = $errors))),
        ),
    );

    onMount(() =>
        formStateStore.subscribe($state =>
            rememberStore.update(touch(state => (state.success = $state.success))),
        ),
    );

    function restore() {
        const restored = get(rememberStore);
        defaultsStore.set(restored.defaults);
        dataStore.set(restored.data);
        errorsStore.set(restored.errors);
    }

    let transform: ((data: T) => any) | undefined = undefined;
    let cancelToken: { cancel(): void } | undefined = undefined;

    restore();

    const form: FormController<T> = {
        subscribe: formStateStore.subscribe,
        restore() {
            restore();
            return this;
        },
        reset(...fields) {
            const defaults = get(defaultsStore);
            if (!fields.length) {
                dataStore.set(cloneDeep(defaults));
                return this;
            }
            const data = get(dataStore);
            for (const field of fields) {
                if (field in defaults) {
                    (data as any)[field] = cloneDeep(defaults[field]);
                } else {
                    (data as any)[field] = undefined;
                }
            }
            dataStore.set(data);
            return this;
        },
        defaults: function (this: FormController<T>, data?: T) {
            if (!data) return get(defaultsStore);
            defaultsStore.set(cloneDeep(data));
            return this;
        } as any,
        error(key: string, errors: string | string[], append = false) {
            const $errors = get(errorsStore);
            const err = $errors[key] || [];
            if (typeof errors === 'string') {
                errors = [errors];
            }
            if (append) {
                errors = err.concat(errors);
            }
            $errors[key] = errors;
            errorsStore.set($errors);
            return this;
        },
        clearErrors(...keys) {
            if (!keys.length) {
                errorsStore.set({});
                return this;
            }
            errorsStore.update(
                touch($errors => {
                    for (const key of keys) {
                        delete $errors[key];
                    }
                }),
            );
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
                    formStateStore.update(touch(state => (state.success = undefined)));
                    return options.onBefore?.(visit);
                },
                onStart: visit => {
                    formStateStore.update(touch(state => (state.processing = true)));
                    options.onStart?.(visit);
                },
                onProgress: event => {
                    formStateStore.update(touch(state => (state.progress = event)));
                    options.onProgress?.(event);
                },
                onSuccess: page => {
                    errorsStore.set({});
                    formStateStore.set({
                        dirty: false,
                        processing: false,
                        success: true,
                    });
                    options.onSuccess?.(page);
                },
                onError: errors => {
                    errorsStore.set(
                        Object.fromEntries(
                            Object.entries(errors as any as Record<string, string[] | string>).map(
                                ([k, v]) => [k, typeof v === 'string' ? [v] : v],
                            ),
                        ),
                    );
                    formStateStore.set({
                        dirty: true,
                        processing: false,
                        success: false,
                    });
                    options.onError?.(errors);
                },
                data: transform ? transform(cloneDeep(get(dataStore))) : get(dataStore),
            };
            router.visit(url, opt);
        },
        post(url, options) {
            this.submit('post', url, options);
        },
        put(url, options) {
            this.submit('put', url, options);
        },
        patch(url, options) {
            this.submit('patch', url, options);
        },
        delete(url, options) {
            this.submit('delete', url, options);
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
        data: dataStore,
        errors: {
            subscribe: errorsStore.subscribe,
        },
    };
}
