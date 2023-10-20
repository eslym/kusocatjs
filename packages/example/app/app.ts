import 'reflect-metadata';
import { App, key } from '@kusocat/core';
import { Inertia, handleInertia } from '@kusocat/inertia';
import { router } from '$app/routes';
import { setCookies } from '@kusocat/core/middleware';

export const app = new App()
    .set(key.router, router)
    .on('request', req => {
        req.register(Inertia.inertiaContext, Inertia.create);
        req.resolved(Inertia.inertiaContext, inertia => {
            if (!req.has(key.request.route)) return;
            inertia.share('route', () => req.get(key.request.route).name);
        });
    })
    .use([setCookies, handleInertia]);
