type StringOnly<T> = T extends string ? T : never;

function getAllKeys<T extends object>(obj: T) {
    const keys = new Set<any>();
    let current = obj;
    do {
        Object.getOwnPropertyNames(current).forEach(
            key => typeof key === 'string' && keys.add(key),
        );
        current = Object.getPrototypeOf(current);
    } while (current);
    return keys as Set<StringOnly<keyof T>>;
}

/**
 * Clone a request, a fix for Bun's `Request.clone()` method.
 * @param req original request
 * @param url the url to replace the original request url
 * @returns cloned request
 */
export function cloneRequest(req: Request, url?: string | URL) {
    const keys = getAllKeys(req);
    const init: any = {};
    for (const key of keys) {
        if (typeof req[key] !== 'function') {
            init[key] = req[key];
        }
    }
    return new Request(
        typeof url === 'undefined' ? req.url : typeof url === 'string' ? url : url.toString(),
        init,
    );
}
