import { key, type ContextInterface } from './context';
import type { CookiesInterface } from './cookies';
import type { EncryptionInterface } from './encryption';

export interface SessionInterface {
    has(key: string): boolean;
    get<T extends any>(key: string): T | undefined;
    set<T extends any>(key: string, value: T): void;
    delete(key: string): void;
    clear(): void;
    commit(): Promise<void>;
}

export class BasicCookieSession implements SessionInterface {
    #cookies: CookiesInterface;
    #crypto: EncryptionInterface;
    #data: Map<string, any> = new Map();

    constructor(cookies: CookiesInterface, crypto: EncryptionInterface) {
        this.#cookies = cookies;
        this.#crypto = crypto;
    }

    has(key: string) {
        return this.#data.has(key);
    }

    get<T extends any>(key: string): T | undefined {
        return this.#data.get(key);
    }

    set<T extends any>(key: string, value: T): void {
        this.#data.set(key, value);
    }

    delete(key: string): void {
        this.#data.delete(key);
    }

    clear(): void {
        this.#data.clear();
    }

    async commit(): Promise<void> {
        const encrypted = await this.#crypto.encryptJSON(Object.fromEntries(this.#data));
        this.#cookies.set('session', encrypted);
    }

    static async create(ctx: ContextInterface) {
        return new BasicCookieSession(await ctx.get(key.request.cookies), ctx.get(key.encryption));
    }
}
