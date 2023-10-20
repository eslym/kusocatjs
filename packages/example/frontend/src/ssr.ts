import { createSSRRender } from '@kusocat/inertia-svelte/ssr';
import { resolvePage } from './resolve';

const renderSvelte = createSSRRender(resolvePage);

export async function render(template: string, page: Parameters<typeof renderSvelte>[0]) {
    const { head, html } = await renderSvelte(page);

    return template
        .replace(
            '<!--head-->',
            `<script>window.__initialPage = ${JSON.stringify(page)}</script>\n${head}`,
        )
        .replace('<!--app-->', html);
}
