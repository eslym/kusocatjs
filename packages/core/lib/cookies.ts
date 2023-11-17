import { type CookieSerializeOptions, parse, serialize } from 'cookie';
import { key, type ContextInterface } from './context';

export interface CookiesInterface {
    get(key: string): string | undefined;
    set(key: string, value: string, options?: Omit<CookieSerializeOptions, 'encode'>): void;
    delete(
        key: string,
        options?: Omit<CookieSerializeOptions, 'encode' | 'expires' | 'maxAge'>,
    ): void;
    headers(): string[];
}

export class Cookies implements CookiesInterface {
    #cookies: Record<string, string> = {};
    #headers: Map<string, string> = new Map();

    constructor(request: Request) {
        this.#cookies = parse(request.headers.get('Cookie') ?? '');
    }

    get(key: string) {
        return this.#cookies[key];
    }

    set(key: string, value: string, options?: Omit<CookieSerializeOptions, 'encode'>) {
        this.#cookies[key] = value;
        this.#headers.set(key, serialize(key, value, options));
    }

    delete(key: string, options?: Omit<CookieSerializeOptions, 'encode' | 'expires' | 'maxAge'>) {
        delete this.#cookies[key];
        this.#headers.set(key, serialize(key, '', { ...options, expires: new Date(0), maxAge: 0 }));
    }

    headers() {
        return Array.from(this.#headers.values());
    }

    static async factory(ctx: ContextInterface) {
        return new Cookies(ctx.get(key.request));
    }
}
