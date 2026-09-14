/**
 * SillyTavern server plugin: proxy NovelAI image generation to avoid browser CORS.
 *
 * Install:
 *   1. Copy this folder to SillyTavern/plugins/nai-scene-draw/
 *   2. Set enableServerPlugins: true in config.yaml
 *   3. Restart SillyTavern
 *
 * Routes:
 *   GET  /api/plugins/nai-scene-draw/ping
 *   POST /api/plugins/nai-scene-draw/generate
 */

const DEFAULT_API = 'https://image.novelai.net';

function pngSlice(buf) {
    const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const start = u8.indexOf(sig);
    if (start < 0) return u8;
    const iend = Buffer.from('IEND');
    const iendAt = u8.indexOf(iend, start + 8);
    if (iendAt < 0) return u8.subarray(start);
    return u8.subarray(start, iendAt + 8);
}

async function init(router) {
    router.get('/ping', (_req, res) => {
        res.json({ ok: true, plugin: 'nai-scene-draw' });
    });

    router.post('/generate', async (req, res) => {
        try {
            const token = String(req.body?.token || '').trim();
            const apiBase = String(req.body?.apiBase || DEFAULT_API).replace(/\/+$/, '');
            const payload = req.body?.payload;
            if (!token) {
                res.status(400).json({ error: 'missing NovelAI token' });
                return;
            }
            if (!payload || typeof payload !== 'object') {
                res.status(400).json({ error: 'missing payload' });
                return;
            }

            const url = `${apiBase}/ai/generate-image`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/x-zip-compressed',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                res.status(response.status).json({
                    error: `NovelAI ${response.status} ${response.statusText} ${text}`.slice(0, 500),
                });
                return;
            }

            const ab = await response.arrayBuffer();
            const png = pngSlice(Buffer.from(ab));
            res.json({
                ok: true,
                dataUrl: `data:image/png;base64,${png.toString('base64')}`,
            });
        } catch (err) {
            console.error('[nai-scene-draw]', err);
            res.status(500).json({ error: err.message || String(err) });
        }
    });

    console.log('[nai-scene-draw] server plugin loaded');
    return Promise.resolve();
}

async function exit() {
    return Promise.resolve();
}

module.exports = {
    init,
    exit,
    info: {
        id: 'nai-scene-draw',
        name: 'NAI Scene Draw Proxy',
        description: 'Proxies NovelAI /ai/generate-image so the UI extension can avoid CORS.',
    },
};
