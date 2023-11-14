import { key, type ContextInterface } from './context';
import type { CookiesInterface } from './cookies';
import type { EncryptionInterface } from './encryption';

export interface SessionInterface {
    has(key: string): boolean;
    get<T extends any>(key: string): T | undefined;
    set<T extends any>(key: string, value: T): SessionInterface;
    flash(key: string, value: any): SessionInterface;
    keep(...keys: string[]): SessionInterface;
    reflash(...keys: string[]): SessionInterface;
    delete(key: string): SessionInterface;
    clear(): SessionInterface;
    commit(): Promise<void>;
}

export class BasicCookieSession implements SessionInterface {
    #cookies: CookiesInterface;
    #crypto: EncryptionInterface;
    #data: Map<string, any>;
    #flash: Set<string>;
    #reflash: Set<string> = new Set();

    constructor(
        data: Map<string, any>,
        flash: Set<string>,
        cookies: CookiesInterface,
        crypto: EncryptionInterface,
    ) {
        this.#data = data;
        this.#flash = flash;
        this.#cookies = cookies;
        this.#crypto = crypto;
    }

    has(key: string) {
        return this.#data.has(key);
    }

    get<T extends any>(key: string): T | undefined {
        return this.#data.get(key);
    }

    set<T extends any>(key: string, value: T): this {
        this.#data.set(key, value);
        return this;
    }

    flash(key: string, value: any): this {
        this.#data.set(key, value);
        this.#flash.add(key);
        return this;
    }

    keep(...keys: string[]): this {
        keys.forEach(key => this.#reflash.add(key));
        return this;
    }

    reflash(): this {
        this.#flash.forEach(key => this.#reflash.add(key));
        return this;
    }

    delete(key: string): this {
        this.#data.delete(key);
        return this;
    }

    clear(): this {
        this.#data.clear();
        return this;
    }

    async commit(): Promise<void> {
        const data = [
            Object.fromEntries(
                [...this.#data].filter(([key]) => this.#reflash.has(key) || !this.#flash.has(key)),
            ),
            [...this.#flash].filter(
                key => (this.#reflash.has(key) || !this.#flash.has(key)) && this.#data.has(key),
            ),
        ];
        const encrypted = await this.#crypto.encryptJSON(data);
        this.#cookies.set('session', encrypted);
    }

    static async create(ctx: ContextInterface) {
        const cookies = await ctx.get(key.request.cookies);
        const crypto = await ctx.get(key.encryption);
        const session = cookies.get('session');
        if (session) {
            const [data, flash] = await crypto.decryptJSON(session);
            return new BasicCookieSession(new Map(data), new Set(flash), cookies, crypto);
        }
        return new BasicCookieSession(new Map(), new Set(), cookies, crypto);
    }
}
