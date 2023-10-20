import { Router } from '@kusocat/core';
import { Inertia } from '@kusocat/inertia';
import { GameController } from './controller/game-controller';

const router = new Router();

router.get('/', Inertia.handle('home')).name('home');
router.get('/about', Inertia.handle('about')).name('about');

router.prefix('sverdle').group('/sverdle', router => {
    router.get('/', [GameController, 'sverdle']).name('');
    router.get('/how-to-play', Inertia.handle('sverdle/how')).name('.how');
});

export { router };
