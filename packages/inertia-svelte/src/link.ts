import { router, mergeDataIntoQueryString, type VisitOptions } from '@inertiajs/core';

export function shouldIntercept(event: MouseEvent): boolean {
    if (event.defaultPrevented) return false;
    const isLink = event.target && (event.target as HTMLElement).tagName.toLowerCase() === 'a';
    if (!isLink) return false;
    const target = event.target as HTMLAnchorElement;
    return !(
        target.isContentEditable ||
        (target.target && target.target !== '_self') ||
        event.button != 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
    );
}

function hrefAndData(node: HTMLElement, options: VisitOptions) {
    return mergeDataIntoQueryString(
        options.method || 'get',
        (node as any).href || '',
        (options.data as any) || {},
        options.queryStringArrayFormat || 'brackets',
    );
}

function fireEvent(node: HTMLElement, name: string, eventOptions: any = {}) {
    return node.dispatchEvent(new CustomEvent(name, eventOptions));
}

export function link(node: HTMLElement, options: VisitOptions & { href?: string } = {}) {
    function update(newOptions: VisitOptions & { href?: string }) {
        options = newOptions;
    }

    function onClick(event: MouseEvent) {
        if (!shouldIntercept(event as any)) return;
        event.preventDefault();
        const target = event.target as HTMLElement;
        if (target.ariaDisabled === 'true') return;
        const [href, data] = hrefAndData(target, options);
        router.visit(href, {
            onCancelToken: () => fireEvent(target, 'cancel-token'),
            onBefore: visit => fireEvent(target, 'before', { detail: { visit } }),
            onStart: visit => fireEvent(target, 'start', { detail: { visit } }),
            onProgress: progress => fireEvent(target, 'progress', { detail: { progress } }),
            onFinish: visit => fireEvent(target, 'finish', { detail: { visit } }),
            onCancel: () => fireEvent(target, 'cancel'),
            onSuccess: page => fireEvent(target, 'success', { detail: { page } }),
            onError: errors => fireEvent(target, 'error', { detail: { errors } }),
            ...data,
        });
    }

    node.addEventListener('click', onClick);

    return {
        update,
        destroy() {
            node.removeEventListener('click', onClick);
        },
    };
}
