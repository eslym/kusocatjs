import { GameManager } from '$app/lib/game';
import { CookiesInterface, RequestContext, context, key, singleton } from '@kusocat/core';
import { Inertia } from '@kusocat/inertia';
import { randomUUID } from 'crypto';

export class GameController {
    @singleton(key.app, GameManager)
    manager!: GameManager;

    @context(key.request.cookies)
    cookies!: CookiesInterface;

    @context(key.request)
    request!: Request;

    @context(Inertia.inertiaContext)
    inertia!: Inertia;

    async sverdle(req: RequestContext) {
        if (!this.cookies.get('sesid')) {
            this.cookies.set('sesid', randomUUID());
        }
        const game = this.manager.get(this.cookies.get('sesid')!);
        if (this.request.headers.get('upgrade') === 'websocket' && req.upgrade(game)) {
            return 'upgraded';
        }
        return this.inertia.render('sverdle/game', game.serialized);
    }
}
