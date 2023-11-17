import { exists, mkdir, readdir, rm, stat } from 'fs/promises';
import { key, type ContextInterface, createContextKey } from './context';
import type { CookiesInterface } from './cookies';
import type { EncryptionInterface } from './encryption';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export interface SessionInterface {
    has(key: string): boolean;
    get<T extends any>(key: string): T | undefined;
    set<T extends any>(key: string, value: T): SessionInterface;
    flash(key: string, value: any): SessionInterface;
    keep(...keys: string[]): SessionInterface;
    reflash(): SessionInterface;
    delete(key: string): SessionInterface;
    clear(): SessionInterface;
    commit(): Promise<SessionInterface>;
}

export abstract class BaseSession {
    #data: Map<string, any>;
    #flash: Set<string> = new Set();
    #exclude: Set<string>;

    protected get __data() {
        return this.#data;
    }

    protected get __flash() {
        return this.#flash;
    }

    protected get __exclude() {
        return this.#exclude;
    }

    constructor(data: Map<string, any>, flash: Set<string>) {
        this.#data = data;
        this.#exclude = flash;
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
        this.#exclude.delete(key);
        return this;
    }

    keep(...keys: string[]): this {
        keys.forEach(key => {
            if (!this.#exclude.has(key)) return;
            this.#flash.add(key);
            this.#exclude.delete(key);
        });
        return this;
    }

    reflash(): this {
        this.#exclude.forEach(key => this.#flash.add(key));
        this.#exclude.clear();
        return this;
    }

    delete(key: string): this {
        this.#data.delete(key);
        this.#flash.delete(key);
        this.#exclude.delete(key);
        return this;
    }

    clear(): this {
        this.#data.clear();
        return this;
    }

    abstract commit(): Promise<this>;
}

export class BasicCookieSession extends BaseSession implements SessionInterface {
    #cookies: CookiesInterface;
    #crypto: EncryptionInterface;

    constructor(
        data: Map<string, any>,
        flash: Set<string>,
        cookies: CookiesInterface,
        crypto: EncryptionInterface,
    ) {
        super(data, flash);
        this.#cookies = cookies;
        this.#crypto = crypto;
    }

    async commit(): Promise<this> {
        const excludes = this.__exclude;
        const data = [
            Object.fromEntries([...this.__data].filter(([key]) => !excludes.has(key))),
            [...this.__flash],
        ];
        const encrypted = await this.#crypto.encryptJSON(data);
        this.#cookies.set('session', encrypted);
        return this;
    }

    static async create(ctx: ContextInterface) {
        const cookies = await ctx.get(key.request.cookies);
        const crypto = ctx.get(key.encryption);
        const session = cookies.get('session');
        if (session) {
            const [data, flash] = await crypto.decryptJSON(session);
            return new BasicCookieSession(new Map(data), new Set(flash), cookies, crypto);
        }
        return new BasicCookieSession(new Map(), new Set(), cookies, crypto);
    }
}

export class FileBasedSessionManager {
    #dir: string;
    #expires: number;
    #cookieName: string;

    constructor(
        dir: string,
        expires: number = 7 * 24 * 60 * 60 * 1000,
        cookieName: string = 'sesid',
    ) {
        this.#dir = dir;
        this.#expires = expires;
        this.#cookieName = cookieName;
    }

    async createSession(ctx: ContextInterface) {
        const cookies = await ctx.get(key.request.cookies);
        let id = cookies.get(this.#cookieName);
        if (id) {
            const path = `${this.#dir}/${id.slice(0, 2)}/${id}.json`;
            if (await exists(path)) {
                const data = JSON.parse(await Bun.file(path).json());
                const [expires, data_, flash] = data;
                if (Date.now() < expires) {
                    return new FileBasedSession(path, new Map(data_), new Set(flash), expires);
                } else {
                    await rm(path);
                }
            }
        }
        cookies.set(this.#cookieName, (id = randomUUID()));
        return new FileBasedSession(
            `${this.#dir}/${id.slice(0, 2)}/${id}.json`,
            new Map(),
            new Set(),
            this.#expires,
        );
    }

    async cleanup() {
        const acceptedModified = Date.now() - this.#expires;
        const dirs = await readdir(this.#dir);
        for (const dir of dirs) {
            const path = `${this.#dir}/${dir}`;
            const stats = await stat(path);
            if (stats.mtimeMs < acceptedModified) {
                await rm(path, { recursive: true });
                continue;
            }
            const files = await readdir(path);
            for (const file of files) {
                const path = `${this.#dir}/${dir}/${file}`;
                const stats = await stat(path);
                if (stats.mtimeMs < acceptedModified) {
                    await rm(path);
                }
            }
        }
    }

    static contextKey = createContextKey('session-manager');
}

export class FileBasedSession extends BaseSession implements SessionInterface {
    #path: string;
    #expires: number;

    constructor(path: string, data: Map<string, any>, flash: Set<string>, expires: number) {
        super(data, flash);
        this.#path = path;
        this.#expires = expires;
    }

    async commit(): Promise<this> {
        const excludes = this.__exclude;
        const data = [
            Date.now() + this.#expires,
            Object.fromEntries([...this.__data].filter(([key]) => !excludes.has(key))),
            [...this.__flash],
        ];
        if (!(await exists(dirname(this.#path)))) {
            await mkdir(dirname(this.#path), { recursive: true });
        }
        await Bun.write(this.#path, JSON.stringify(data));
        return this;
    }
}
