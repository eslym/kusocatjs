import { App, WebSocketHandler, context, key } from '@kusocat/core';
import { Server, ServerWebSocket } from 'bun';
import { allowed, words } from './words';

class Game implements WebSocketHandler {
    #app: App;
    #id: string;
    #answer: string;
    #guesses: string[];
    #answers: string[];

    #end: boolean = false;
    #failed: boolean = false;

    get serialized() {
        return {
            data: {
                answer: this.#end ? this.#answer : undefined,
                guesses: this.#guesses,
                answers: this.#answers,
            },
            form: this.#failed
                ? {
                      badGuess: true,
                  }
                : undefined,
        };
    }

    constructor(app: App, id: string) {
        this.#app = app;
        this.#id = id;
        this.#answer = words[Math.floor(Math.random() * words.length)];
        this.#guesses = Array(6).fill('');
        this.#answers = [];
    }

    message(ws: ServerWebSocket<WebSocketHandler>, message: string | Buffer): void | Promise<void> {
        const current = this.#answers.length;
        this.#failed = false;
        const key = message.toString();
        switch (key) {
            case 'backspace':
                {
                    this.#guesses[current] = this.#guesses[current].slice(0, -1);
                    ws.publish(this.#id, JSON.stringify(this.serialized));
                }
                break;
            case 'enter':
                {
                    if (this.#guesses[current].length !== 5) return;
                    this.#failed = !this.#enter(this.#guesses[current]);
                    this.#end = this.#answers.length >= 6;
                    this.#app.server.publish(this.#id, JSON.stringify(this.serialized));
                }
                break;
            case 'reset':
                {
                    this.#answer = words[Math.floor(Math.random() * words.length)];
                    this.#guesses = Array(6).fill('');
                    this.#answers = [];
                    this.#end = false;
                    this.#failed = false;
                    this.#app.server.publish(this.#id, JSON.stringify(this.serialized));
                }
                break;
            default:
                {
                    if (key.length !== 1) return;
                    if (this.#guesses[current].length >= 5) return;
                    this.#guesses[current] += key;
                    ws.publish(this.#id, JSON.stringify(this.serialized));
                }
                break;
        }
    }

    open(ws: ServerWebSocket<WebSocketHandler>): void | Promise<void> {
        ws.subscribe(this.#id);
    }

    #enter(word: string) {
        if (!allowed.has(word)) return false;
        this.#guesses[this.#answers.length] = word;
        const letters = Array.from(word);
        const available = Array.from(this.#answer);
        const answer = Array(5).fill('_');

        // first, find exact matches
        for (let i = 0; i < 5; i += 1) {
            if (letters[i] === available[i]) {
                answer[i] = 'x';
                available[i] = ' ';
            }
        }

        // then find close matches (this has to happen
        // in a second step, otherwise an early close
        // match can prevent a later exact match)
        for (let i = 0; i < 5; i += 1) {
            if (answer[i] === '_') {
                const index = available.indexOf(letters[i]);
                if (index !== -1) {
                    answer[i] = 'c';
                    available[index] = ' ';
                }
            }
        }

        this.#answers.push(answer.join(''));
        return true;
    }
}

export class GameManager {
    #games: Map<string, Game> = new Map();

    @context(key.app)
    app!: App;

    get(id: string) {
        if (!this.#games.has(id)) {
            this.#games.set(id, new Game(this.app, id));
        }
        return this.#games.get(id)!;
    }
}
