import { isIP, isIPv4, isIPv6 } from 'net';
import type { App } from './app';
import IPCIDR from 'ip-cidr';
import { key, createContextKey } from './context';
import type { SocketAddress } from 'bun';

const validForwardedProto = new Set(['http', 'https', 'ws', 'wss']);

function isTrusted(ip: string, trusted: IPCIDR[]) {
    return trusted.some(trust => trust.contains(ip));
}

function mapTrust(trust: string) {
    if (isIPv6(trust)) {
        return new IPCIDR(`${trust}/128`);
    }
    if (isIPv4(trust)) {
        return new IPCIDR(`${trust}/32`);
    }
    if (IPCIDR.isValidCIDR(trust)) {
        return new IPCIDR(trust);
    }
    throw new Error(`Invalid trusted proxy: ${trust}`);
}

const originalRequest = createContextKey<Request>('trustedproxy.original.request');

const originalAddress = createContextKey<SocketAddress>('trustedproxy.original.address');

export const trustedProxy = Object.assign(
    function trustedProxy(app: App, trusted: string | string[], ...layers: (string | string[])[]) {
        const proxies = [trusted, ...layers].map(trust =>
            typeof trust === 'string' ? [mapTrust(trust)] : trust.map(mapTrust),
        );
        // use app.on('request') is executed before router resolves, so we want it to be here.
        return app.on('request', ctx => {
            const request = ctx.get(key.request);
            const remote = ctx.get(key.request.address);
            if (!remote) {
                return;
            }
            if (!request.headers.has('x-forwarded-for')) {
                return;
            }
            if (!isTrusted(remote.address, proxies[0])) {
                return;
            }
            const chain = request.headers
                .get('x-forwarded-for')!
                .split(',')
                .map(ip => ip.trim());
            let layer = 0;
            let current = chain.pop()!;
            let forwarded: string | undefined = undefined;
            do {
                if (!isIP(current)) {
                    chain.push(current);
                    break;
                }
                forwarded = current;
                layer++;
                if (layer >= proxies.length || !isTrusted(current, proxies[layer])) break;
            } while ((current = chain.pop()!));
            if (!forwarded) {
                return;
            }
            ctx.set(originalRequest, request);
            ctx.set(originalAddress, remote);
            const address: SocketAddress = {
                address: forwarded,
                family: isIPv4(forwarded) ? 'IPv4' : 'IPv6',
                port: remote.port,
            };
            const url = new URL(request.url);
            const proto = request.headers.get('x-forwarded-proto');
            if (proto && validForwardedProto.has(proto)) {
                url.protocol = proto.replace('ws', 'http');
            }
            const host = request.headers.get('x-forwarded-host');
            if (host) {
                url.host = host;
            }
            const req = new Request(url.toString(), request.clone());
            request.headers.set('x-forwarded-for', chain.join(', '));
            ctx.set(key.request, req);
            ctx.set(key.request.address, address);
        });
    },
    {
        originalRequest,
        originalAddress,
        loopback: ['127.0.0.1/8', '::1/128'] as const,
        privateNetworks: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fd00::/8'] as const,
    },
);
