/**
 * SillyTavern extension: NAI 情景生图（锁外貌）
 * 扮演模型只写中文剧情；外貌由角色身份证锁死；表情/足/洞按最近正文开关。
 */
(function () {
    'use strict';

    const MODULE = 'nai_scene_draw';
    const CHAR_FIELD = 'nai_scene_draw_identity';
    const DEFAULT_API = 'https://image.novelai.net';
    const PROXY_PATH = '/api/plugins/nai-scene-draw/generate';
    const PROXY_PING = '/api/plugins/nai-scene-draw/ping';
    const FOLDER = 'third-party/SillyTavern-NAI-SceneDraw';

    const DEFAULTS = Object.freeze({
        apiToken: '',
        apiBase: DEFAULT_API,
        useProxy: true,
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        cfgRescale: 0,
        nSamples: 1,
        seed: -1,
        qualityToggle: true,
        variety: false,
        autoSmea: false,
        ucPreset: 0,
        sizePreset: '832x1216',
        suffix: '',
        artist: '',
        schemes: [],
        activeSchemeId: '',
        previewTags: 'ahegao, rolling eyes, tongue out, open mouth, drooling, saliva, fellatio, oral, 1boy, penis, looking at viewer',
        commonPrefix: 'masterpiece, best quality, absurdres, very aesthetic, anime coloring, year 2025',
        negative: 'lowres, worst quality, bad anatomy, extra fingers, extra legs, child, loli, cute face, text, watermark, logo, jpeg artifacts, artistic error',
        useLlmScene: false,
        autoGenerate: false,
        identities: {},
        showFloat: true,
        panelOpen: false,
        panelMin: false,
        panelX: null,
        panelY: null,
        launcherX: null,
        launcherY: null,
    });

    const SIZE_PRESETS = {
        '832x1216': [832, 1216],
        '1216x832': [1216, 832],
        '1024x1024': [1024, 1024],
        '1024x1536': [1024, 1536],
        '1536x1024': [1536, 1024],
        '512x768': [512, 768],
        '768x512': [768, 512],
    };

    const LEXICON = [
        {
            id: 'ahegao',
            keys: ['阿嘿颜', '哈嘿颜', '啊嘿颜', '阿黑颜', '翻白眼', '白眼', '吐舌', '失神', '哦齁齁', '哦齁', 'ahegao'],
            tags: 'ahegao, rolling eyes, tongue out, open mouth, drooling, saliva, blush, empty eyes',
        },
        {
            id: 'endure',
            keys: ['咬唇', '忍着', '隐忍', '眼尾红', '不敢叫', '压抑'],
            tags: 'biting lip, half-closed eyes, blush, looking away, parted lips',
        },
        {
            id: 'feet',
            keys: ['脱鞋', '刚脱', '鞋垫', '袜底', '蒸汽', '脚臭', '臭袜', '闻脚', '鞋里', '热脚', '原味袜'],
            tags: 'removing shoes, steam, sweaty feet, dirty soles, used socks, insoles, soles',
        },
        {
            id: 'glory',
            keys: ['荣耀洞', '光荣洞', '墙洞', '隔间洞', 'glory hole', 'gloryhole'],
            tags: 'glory hole, hole in wall, partition',
        },
        {
            id: 'foot_hole',
            keys: ['脚从洞', '伸脚', '脚洞', '鞋从洞'],
            tags: 'feet through hole, soles, toes',
        },
    ];

    const LLM_INSTRUCTION = `你是生图情景翻译器，不是角色扮演。
禁止输出外貌（头发、眼睛、年龄、胸、臀、婚戒等，已由系统注入）。
只根据正文勾选，没写到的不要脑补。
只输出一行英文逗号标签，不要解释。
表情：正常脸不要写 ahegao；隐忍用 biting lip, half-closed eyes, blush；阿嘿颜用 ahegao, rolling eyes, tongue out, open mouth, drooling。
足：仅当出现脱鞋/袜底/蒸汽/脚臭时才写 removing shoes, steam, sweaty feet, dirty soles。
洞：仅当出现荣耀洞/墙洞时才写 glory hole, hole in wall。
正文：
`;

    let generating = false;
    let dragState = null;

    function ctx() {
        return (window.SillyTavern && SillyTavern.getContext && SillyTavern.getContext()) || {};
    }

    function toast(type, msg) {
        try {
            if (window.toastr && typeof toastr[type] === 'function') {
                toastr[type](msg);
                return;
            }
        } catch (_) { /* ignore */ }
        console[type === 'error' ? 'error' : 'log'](`[${MODULE}]`, msg);
    }

    function getSettings() {
        const c = ctx();
        const bag = c.extensionSettings || {};
        if (!bag[MODULE]) bag[MODULE] = {};
        const s = bag[MODULE];
        for (const key of Object.keys(DEFAULTS)) {
            if (!Object.prototype.hasOwnProperty.call(s, key)) {
                s[key] = typeof structuredClone === 'function'
                    ? structuredClone(DEFAULTS[key])
                    : JSON.parse(JSON.stringify(DEFAULTS[key]));
            }
        }
        if (!s.identities || typeof s.identities !== 'object') s.identities = {};
        if (!Array.isArray(s.schemes)) s.schemes = [];
        return s;
    }

    function saveSettings() {
        const c = ctx();
        if (typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced();
    }

    function charKey() {
        const c = ctx();
        const id = c.characterId;
        const ch = (id !== undefined && id !== null && c.characters) ? c.characters[id] : null;
        return ch?.avatar || ch?.name || 'default';
    }

    function charDisplayName() {
        const c = ctx();
        const id = c.characterId;
        const ch = (id !== undefined && id !== null && c.characters) ? c.characters[id] : null;
        return ch?.name || c.name2 || '未选择角色';
    }

    function readCardIdentity() {
        const c = ctx();
        const id = c.characterId;
        if (id === undefined || id === null || !c.characters) return '';
        const ch = c.characters[id];
        return String(ch?.data?.extensions?.[CHAR_FIELD] || '').trim();
    }

    function getIdentity() {
        const card = readCardIdentity();
        if (card) return card;
        return String(getSettings().identities[charKey()] || '').trim();
    }

    async function setIdentity(text) {
        const value = String(text || '').trim();
        const s = getSettings();
        s.identities[charKey()] = value;
        saveSettings();
        const c = ctx();
        if (typeof c.writeExtensionField === 'function' && c.characterId !== undefined && c.characterId !== null) {
            try {
                await c.writeExtensionField(c.characterId, CHAR_FIELD, value);
            } catch (err) {
                console.warn(`[${MODULE}] writeExtensionField failed`, err);
            }
        }
        updateFloatStatus();
    }

    function stripHtml(html) {
        return String(html || '')
            .replace(/<img[\s\S]*?>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function recentText(n = 2) {
        const chat = ctx().chat || [];
        return chat.slice(-Math.max(1, n)).map(m => stripHtml(m.mes)).filter(Boolean).join('\n');
    }

    function matchLexicon(text) {
        const hit = [];
        const lower = String(text || '').toLowerCase();
        for (const row of LEXICON) {
            if (row.keys.some(k => text.includes(k) || lower.includes(String(k).toLowerCase()))) {
                hit.push(row);
            }
        }
        return hit;
    }

    function buildPrompt(sceneRows, extraScene = '') {
        const s = getSettings();
        const identity = getIdentity();
        const sceneParts = [...sceneRows.map(r => r.tags), extraScene].filter(Boolean);
        const scene = sceneParts.join(', ');
        const face = sceneRows.find(r => r.id === 'ahegao' || r.id === 'endure');
        const charPrompt = [identity, face ? face.tags : ''].filter(Boolean).join(', ');
        const base = [s.commonPrefix, s.artist, scene, s.suffix].filter(Boolean).join(', ');
        let negative = s.negative;
        if (!sceneRows.some(r => r.id === 'ahegao')) {
            negative += ', ahegao, rolling eyes, tongue out, fucked silly, heart-shaped pupils';
        }
        if (!sceneRows.some(r => r.id === 'glory' || r.id === 'foot_hole')) {
            negative += ', glory hole, hole in wall';
        }
        return { identity, base, charPrompt: charPrompt || identity, scene, negative, rows: sceneRows };
    }

    async function llmScene(text) {
        if (!getSettings().useLlmScene) return '';
        const c = ctx();
        const prompt = LLM_INSTRUCTION + text;
        try {
            let raw = '';
            if (typeof c.generateQuietPrompt === 'function') {
                try {
                    raw = await c.generateQuietPrompt({ quietPrompt: prompt });
                } catch (_) {
                    raw = await c.generateQuietPrompt(prompt, false, false);
                }
            }
            const line = String(raw || '')
                .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
                .split('\n')
                .map(x => x.trim())
                .find(x => x && /[a-z]/i.test(x) && !/^你是/.test(x)) || '';
            return line
                .replace(/\b(brown|black|blonde|white|red|blue|green|pink|purple|silver|gray|grey) (hair|eyes)\b/gi, '')
                .replace(/\b(huge breasts|wide hips|wedding ring|milf|1girl|mature female|thick thighs)\b/gi, '')
                .replace(/,{2,}/g, ',')
                .replace(/^\s*,|,\s*$/g, '')
                .trim();
        } catch (err) {
            console.warn(`[${MODULE}] LLM scene fallback`, err);
            return '';
        }
    }

    function extractPng(buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let start = -1;
        outer: for (let i = 0; i < u8.length - 8; i++) {
            for (let j = 0; j < 8; j++) if (u8[i + j] !== sig[j]) continue outer;
            start = i;
            break;
        }
        if (start < 0) {
            const head = new TextDecoder().decode(u8.slice(0, 200));
            throw new Error('返回内容里没有 PNG：' + head.slice(0, 180));
        }
        const iend = [0x49, 0x45, 0x4e, 0x44];
        for (let i = start + 8; i < u8.length - 8; i++) {
            if (iend.every((b, j) => u8[i + j] === b)) {
                return u8.slice(start, i + 8);
            }
        }
        return u8.slice(start);
    }

    function pngToDataUrl(u8) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < u8.length; i += chunk) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
        }
        return `data:image/png;base64,${btoa(bin)}`;
    }

    function resolveSeed(s) {
        const raw = Number(s.seed);
        if (!Number.isFinite(raw) || raw < 0) return Math.floor(Math.random() * 2 ** 31);
        return Math.floor(raw);
    }

    function naiBody(built) {
        const s = getSettings();
        const seed = resolveSeed(s);
        const charCaption = built.charPrompt || built.identity || built.base;
        const hasChar = Boolean(built.identity);
        const parameters = {
            params_version: 3,
            width: Number(s.width) || 832,
            height: Number(s.height) || 1216,
            scale: Number(s.scale) || 5,
            sampler: s.sampler || 'k_euler_ancestral',
            steps: Number(s.steps) || 28,
            n_samples: Math.min(4, Math.max(1, Number(s.nSamples) || 1)),
            ucPreset: Number(s.ucPreset) || 0,
            qualityToggle: s.qualityToggle !== false,
            noise_schedule: s.noiseSchedule || 'karras',
            cfg_rescale: Number(s.cfgRescale) || 0,
            autoSmea: !!s.autoSmea,
            seed,
            extra_noise_seed: seed,
            negative_prompt: built.negative,
            use_coords: false,
            characterPrompts: hasChar
                ? [{ prompt: charCaption, uc: '', center: { x: 0.5, y: 0.5 }, enabled: true }]
                : [],
            v4_prompt: {
                caption: {
                    base_caption: built.base || 'masterpiece, best quality',
                    char_captions: hasChar
                        ? [{ char_caption: charCaption, centers: [{ x: 0.5, y: 0.5 }] }]
                        : [],
                },
                use_coords: false,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: { base_caption: built.negative, char_captions: [] },
                legacy_uc: false,
            },
        };
        if (s.variety) parameters.skip_cfg_above_sigma = 19;
        return {
            input: [built.base, charCaption].filter(Boolean).join(', '),
            model: s.model,
            action: 'generate',
            parameters,
        };
    }

    function requestHeaders() {
        const c = ctx();
        if (typeof c.getRequestHeaders === 'function') return c.getRequestHeaders();
        return { 'Content-Type': 'application/json' };
    }

    async function callNai(built) {
        const s = getSettings();
        if (!s.apiToken) throw new Error('还没填 NovelAI API Token');
        const body = naiBody(built);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);

        try {
            let res;
            if (s.useProxy) {
                res = await fetch(PROXY_PATH, {
                    method: 'POST',
                    headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: s.apiToken,
                        apiBase: s.apiBase || DEFAULT_API,
                        payload: body,
                    }),
                    signal: controller.signal,
                });
            } else {
                const base = String(s.apiBase || DEFAULT_API).replace(/\/+$/, '');
                res = await fetch(`${base}/ai/generate-image`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${s.apiToken}`,
                        'Content-Type': 'application/json',
                        Accept: 'application/x-zip-compressed',
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            }

            if (!res.ok) {
                let msg = `${res.status} ${res.statusText}`;
                try { msg += ' ' + (await res.text()).slice(0, 400); } catch (_) { /* ignore */ }
                if (res.status === 404 && s.useProxy) {
                    msg += '（服务端插件未安装或未开启 enableServerPlugins）';
                }
                throw new Error(msg);
            }

            const ctype = (res.headers.get('content-type') || '').toLowerCase();
            if (ctype.includes('application/json')) {
                const json = await res.json();
                if (json.error) throw new Error(json.error);
                if (json.dataUrl) return json.dataUrl;
                if (json.image) return json.image.startsWith('data:') ? json.image : `data:image/png;base64,${json.image}`;
            }
            const buf = await res.arrayBuffer();
            return pngToDataUrl(extractPng(buf));
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('出图超时（120s）');
            if (String(err.message || err).includes('Failed to fetch') && !s.useProxy) {
                throw new Error('直连失败（多半是 CORS）。勾选「走酒馆服务端插件代理」，或把 API 地址改成反代。');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    async function uploadAndAttach(dataUrl, caption) {
        const c = ctx();
        let imagePath = dataUrl;
        try {
            const res = await fetch('/api/images/upload', {
                method: 'POST',
                headers: requestHeaders(),
                body: JSON.stringify({
                    image: dataUrl,
                    ch_name: c.name2 || 'NAI',
                }),
            });
            if (res.ok) {
                const json = await res.json();
                imagePath = json.path || json.url || json.image || dataUrl;
            }
        } catch (err) {
            console.warn(`[${MODULE}] upload fallback to data URL`, err);
        }

        const message = {
            name: c.name2 || 'NAI',
            is_user: false,
            is_system: true,
            send_date: Date.now(),
            mes: caption ? `*NAI 情景生图*\n${caption}` : '*NAI 情景生图*',
            extra: {
                image: imagePath,
                title: 'NAI 情景生图',
                inline_image: true,
            },
        };
        if (c.chat) c.chat.push(message);
        if (typeof c.addOneMessage === 'function') c.addOneMessage(message);
        if (typeof c.saveChat === 'function') {
            try { await c.saveChat(); } catch (_) { /* ignore */ }
        } else if (typeof c.saveChatConditional === 'function') {
            try { await c.saveChatConditional(); } catch (_) { /* ignore */ }
        }
    }

    async function assemble() {
        const text = recentText(2);
        const rows = matchLexicon(text);
        const extra = await llmScene(text);
        return buildPrompt(rows, extra);
    }

    function previewText(built) {
        return `【身份证】\n${built.identity || '（空：先填当前角色身份证，否则每张都会换人）'}\n\n` +
            `【本轮情景】\n${built.scene || '（正文没勾中足/洞/阿嘿颜，只会画正常脸）'}\n\n` +
            `【base】\n${built.base}\n\n` +
            `【character】\n${built.charPrompt}\n\n` +
            `【negative】\n${built.negative}\n\n` +
            `【正面提示词】\n${getSettings().artist || '（空）'}\n\n` +
            `【采样】\n${getSettings().sampler || 'k_euler_ancestral'} / ${getSettings().noiseSchedule || 'karras'} / steps ${getSettings().steps} / cfg ${getSettings().scale} / seed ${getSettings().seed}`;
    }

    function previewToBox(built) {
        const text = previewText(built);
        const el = document.getElementById('nsd_preview');
        if (el) el.textContent = text;
        const fel = document.getElementById('nsd_f_preview_box');
        if (fel) fel.textContent = text;
        updateChips(built.rows || []);
        updateFloatStatus();
    }

    function setBusy(on) {
        ['nsd_f_gen', 'nsd_f_preview', 'nsd_btn_gen', 'nsd_btn_preview'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !!on;
        });
        const bar = document.getElementById('nsd_f_progress');
        if (bar) bar.hidden = !on;
        const dot = document.getElementById('nsd_launcher_dot');
        const fab = document.getElementById('nsd_launcher');
        if (dot) {
            dot.classList.toggle('is-busy', !!on);
            if (!on) updateFloatStatus();
        }
        if (fab) fab.classList.toggle('is-busy', !!on);
    }

    async function generateNow(dry = false) {
        if (generating && !dry) return 'busy';
        const built = await assemble();
        previewToBox(built);
        if (!built.identity) {
            toast('warning', '身份证是空的：可以出图，但脸和身材会漂。先填再求一致。');
        }
        if (dry) {
            toast('info', '已预览，没有调用 NAI');
            return 'preview';
        }
        generating = true;
        setBusy(true);
        try {
            toast('info', '正在向 NAI 出图…');
            const dataUrl = await callNai(built);
            await uploadAndAttach(dataUrl, built.scene);
            toast('success', '出图完成');
            return 'ok';
        } finally {
            generating = false;
            setBusy(false);
        }
    }

    function bindValue(id, key, numeric) {
        const el = document.getElementById(id);
        if (!el) return;
        const s = getSettings();
        el.value = s[key] ?? DEFAULTS[key];
        const save = () => {
            getSettings()[key] = numeric ? Number(el.value) : el.value;
            saveSettings();
        };
        el.addEventListener('change', save);
        el.addEventListener('input', save);
    }

    function bindCheckbox(id, key) {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = !!getSettings()[key];
        el.addEventListener('change', () => {
            getSettings()[key] = el.checked;
            saveSettings();
        });
    }

    function reloadIdentityField() {
        const value = getIdentity();
        const idEl = document.getElementById('nsd_identity');
        if (idEl && document.activeElement !== idEl) idEl.value = value;
        const fEl = document.getElementById('nsd_f_identity');
        if (fEl && document.activeElement !== fEl) fEl.value = value;
        const model = getSettings().model;
        const m1 = document.getElementById('nsd_model');
        const m2 = document.getElementById('nsd_f_model');
        if (m1 && document.activeElement !== m1) m1.value = model;
        if (m2 && document.activeElement !== m2) m2.value = model;
        updateFloatStatus();
        refreshSceneChips();
        syncFloatNaiFields();
    }

    function updateChips(rows) {
        const ids = new Set((rows || []).map(r => r.id));
        document.querySelectorAll('#nsd_chips [data-nsd-chip]').forEach(el => {
            el.classList.toggle('is-on', ids.has(el.getAttribute('data-nsd-chip')));
        });
        const hint = document.getElementById('nsd_chip_hint');
        if (hint) {
            hint.textContent = ids.size
                ? '已按最近正文点亮，出图时会带上这些标签。'
                : '日常对话不会点亮。写到了才会加标签。';
        }
    }

    function refreshSceneChips() {
        try {
            updateChips(matchLexicon(recentText(2)));
        } catch (_) { /* ignore */ }
    }

    function updateFloatStatus() {
        const s = getSettings();
        const idOk = Boolean(getIdentity());
        const idState = document.getElementById('nsd_f_id_state');
        if (idState) {
            idState.textContent = idOk ? '身份证已锁' : '身份证未填';
            idState.classList.toggle('nsd-pill-ok', idOk);
            idState.classList.toggle('nsd-pill-warn', !idOk);
        }
        const proxy = document.getElementById('nsd_f_proxy_state');
        if (proxy) proxy.textContent = s.useProxy ? '代理' : '直连';
        const model = document.getElementById('nsd_f_model_state');
        if (model) {
            const map = {
                'nai-diffusion-4-5-full': '4.5 Full',
                'nai-diffusion-5-full': '5 Full',
                'nai-diffusion-4-5-curated': '4.5 Curated',
                'nai-diffusion-5-curated': '5 Curated',
            };
            model.textContent = map[s.model] || s.model;
        }
        const char = document.getElementById('nsd_f_char');
        if (char) char.textContent = charDisplayName();
        const sch = document.getElementById('nsd_f_scheme_state');
        if (sch) sch.textContent = currentScheme()?.name || '无方案';
        const dot = document.getElementById('nsd_launcher_dot');
        if (dot && !generating) {
            dot.classList.toggle('is-ok', idOk && Boolean(s.apiToken));
            dot.classList.remove('is-busy');
        }
        const launcher = document.getElementById('nsd_launcher');
        const overlay = document.getElementById('nsd_overlay');
        if (s.showFloat === false) {
            if (launcher) launcher.style.display = 'none';
            if (overlay) overlay.hidden = true;
        } else if (launcher) {
            launcher.style.display = '';
        }
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function applyPanelPos() {
        const s = getSettings();
        const overlay = document.getElementById('nsd_overlay');
        if (overlay) overlay.hidden = !s.panelOpen;
    }

    function applyLauncherPos() {
        const s = getSettings();
        const launcher = document.getElementById('nsd_launcher');
        if (!launcher) return;
        if (s.launcherX == null || s.launcherY == null) return;
        launcher.style.left = `${clamp(Number(s.launcherX), 8, window.innerWidth - 56)}px`;
        launcher.style.top = `${clamp(Number(s.launcherY), 8, window.innerHeight - 56)}px`;
        launcher.style.right = 'auto';
        launcher.style.bottom = 'auto';
    }

    function enableDrag(handle, target, xKey, yKey) {
        if (!handle || !target) return;
        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (target !== handle && ev.target.closest('button, input, textarea, select, a')) return;
            const rect = target.getBoundingClientRect();
            dragState = {
                target,
                xKey,
                yKey,
                dx: ev.clientX - rect.left,
                dy: ev.clientY - rect.top,
                startX: ev.clientX,
                startY: ev.clientY,
                moved: false,
            };
            handle.setPointerCapture(ev.pointerId);
            ev.preventDefault();
        });
        handle.addEventListener('pointermove', (ev) => {
            if (!dragState || dragState.target !== target) return;
            if (Math.abs(ev.clientX - dragState.startX) + Math.abs(ev.clientY - dragState.startY) > 4) {
                dragState.moved = true;
            }
            const x = ev.clientX - dragState.dx;
            const y = ev.clientY - dragState.dy;
            target.style.left = `${x}px`;
            target.style.top = `${y}px`;
            target.style.right = 'auto';
            target.style.bottom = 'auto';
        });
        const end = (ev) => {
            if (!dragState || dragState.target !== target) return;
            const rect = target.getBoundingClientRect();
            const s = getSettings();
            s[xKey] = Math.round(rect.left);
            s[yKey] = Math.round(rect.top);
            saveSettings();
            if (dragState.moved) target.dataset.nsdDragged = '1';
            dragState = null;
            try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    function openPanel() {
        const s = getSettings();
        s.panelOpen = true;
        s.panelMin = false;
        saveSettings();
        applyPanelPos();
        reloadIdentityField();
        refreshSceneChips();
        syncFloatNaiFields();
    }

    function hidePanel() {
        const s = getSettings();
        s.panelOpen = false;
        saveSettings();
        applyPanelPos();
    }

    function extensionBasePath() {
        try {
            const scripts = Array.from(document.querySelectorAll('script[src]'));
            const hit = scripts.find(s => /NAI-SceneDraw/i.test(s.src || ''));
            if (hit) return hit.src.replace(/\/index\.js(\?.*)?$/i, '');
        } catch (_) { /* ignore */ }
        return `/scripts/extensions/${FOLDER}`;
    }

    async function loadTemplate(name) {
        const c = ctx();
        try {
            if (typeof c.renderExtensionTemplateAsync === 'function') {
                return await c.renderExtensionTemplateAsync(FOLDER, name);
            }
        } catch (err) {
            console.warn(`[${MODULE}] renderExtensionTemplateAsync ${name}`, err);
        }
        const urls = [
            `${extensionBasePath()}/${name}.html`,
            `/scripts/extensions/${FOLDER}/${name}.html`,
        ];
        for (const url of urls) {
            try {
                const html = await $.get(url);
                if (html) return html;
            } catch (err) {
                console.warn(`[${MODULE}] template ${url}`, err);
            }
        }
        throw new Error(`无法加载 ${name}.html`);
    }

    const FLOAT_HTML = `
    <button id="nsd_launcher" class="nsd-fab" type="button" title="NAI 情景生图">
        <i class="fa-solid fa-paintbrush"></i>
        <span id="nsd_launcher_dot" class="nsd-fab-dot"></span>
    </button>
    <div id="nsd_overlay" class="nsd-overlay" hidden>
        <div id="nsd_modal" class="nsd-modal" role="dialog">
            <header class="nsd-modal-head">
                <div class="nsd-modal-title">
                    <span class="nsd-logo">NAI</span>
                    <div>
                        <strong>情景生图</strong>
                        <small id="nsd_f_char">未选择角色</small>
                    </div>
                </div>
                <button id="nsd_btn_hide" class="nsd-icon-btn" type="button" title="关闭">×</button>
            </header>
            <nav class="nsd-tabs">
                <button type="button" class="nsd-tab is-on" data-nsd-tab="draw">出图</button>
                <button type="button" class="nsd-tab" data-nsd-tab="artist">画师串</button>
                <button type="button" class="nsd-tab" data-nsd-tab="params">参数</button>
                <button type="button" class="nsd-tab" data-nsd-tab="char">角色</button>
                <button type="button" class="nsd-tab" data-nsd-tab="setup">连接</button>
            </nav>
            <div class="nsd-modal-body">
                <section class="nsd-tab-pane is-on" data-nsd-pane="draw">
                    <div class="nsd-status">
                        <span id="nsd_f_id_state" class="nsd-pill nsd-pill-warn">身份证未填</span>
                        <span id="nsd_f_proxy_state" class="nsd-pill">代理</span>
                        <span id="nsd_f_model_state" class="nsd-pill">4.5 Full</span>
                        <span id="nsd_f_scheme_state" class="nsd-pill">无方案</span>
                    </div>
                    <div class="nsd-label">本轮情景（跟正文走，不是手动开关）</div>
                    <div id="nsd_chips" class="nsd-chips">
                        <span data-nsd-chip="endure" class="nsd-chip">隐忍</span>
                        <span data-nsd-chip="ahegao" class="nsd-chip">阿嘿颜</span>
                        <span data-nsd-chip="feet" class="nsd-chip">足 / 鞋袜</span>
                        <span data-nsd-chip="glory" class="nsd-chip">荣耀洞</span>
                        <span data-nsd-chip="foot_hole" class="nsd-chip">脚洞</span>
                    </div>
                    <p id="nsd_chip_hint" class="nsd-hint">日常对话不会点亮。写到了才会加标签。</p>
                    <div class="nsd-row nsd-compact">
                        <label>模型
                            <select id="nsd_f_model" class="text_pole">
                                <option value="nai-diffusion-4-5-full">4.5 Full</option>
                                <option value="nai-diffusion-5-full">5 Full</option>
                                <option value="nai-diffusion-4-5-curated">4.5 Curated</option>
                                <option value="nai-diffusion-5-curated">5 Curated</option>
                            </select>
                        </label>
                    </div>
                    <div class="nsd-field">
                        <label>当前正面提示词</label>
                        <textarea id="nsd_f_artist" class="text_pole" rows="2" placeholder="masterpiece, artist:xxx"></textarea>
                    </div>
                    <div class="nsd-actions">
                        <button id="nsd_f_preview" class="nsd-btn nsd-btn-ghost" type="button">预览</button>
                        <button id="nsd_f_gen" class="nsd-btn nsd-btn-primary" type="button">出图</button>
                    </div>
                    <div id="nsd_f_progress" class="nsd-progress" hidden>
                        <span class="nsd-spinner"></span>
                        <span>正在向 NAI 出图…</span>
                    </div>
                    <details class="nsd-details">
                        <summary>本轮提示词</summary>
                        <pre id="nsd_f_preview_box" class="nsd-preview"></pre>
                    </details>
                </section>

                <section class="nsd-tab-pane" data-nsd-pane="artist">
                    <p class="nsd-hint">点效果图切换整套提示词方案（正面 + 后置 + 负向）。默认效果图标签：哈嘿颜口交。</p>
                    <div class="nsd-row nsd-compact">
                        <label>方案
                            <select id="nsd_f_scheme" class="text_pole"></select>
                        </label>
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_scheme_name">方案名</label>
                        <input id="nsd_f_scheme_name" class="text_pole" type="text" placeholder="例如 厚涂 / 水彩" />
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_scheme_artist">正面提示词（含画师串 / 画风前缀）</label>
                        <textarea id="nsd_f_scheme_artist" class="text_pole" rows="3" placeholder="masterpiece, artist:xxx, year 2024"></textarea>
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_scheme_suffix">后置正提示词</label>
                        <textarea id="nsd_f_scheme_suffix" class="text_pole" rows="2" placeholder="cinematic lighting, ..."></textarea>
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_scheme_negative">反提示词</label>
                        <textarea id="nsd_f_scheme_negative" class="text_pole" rows="3" placeholder="lowres, worst quality, ..."></textarea>
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_preview_tags">效果图固定标签</label>
                        <textarea id="nsd_f_preview_tags" class="text_pole" rows="2"></textarea>
                    </div>
                    <div class="nsd-actions nsd-actions-4">
                        <button id="nsd_f_scheme_new" class="nsd-btn" type="button">新建</button>
                        <button id="nsd_f_scheme_save" class="nsd-btn nsd-btn-primary" type="button">保存</button>
                        <button id="nsd_f_scheme_preview" class="nsd-btn" type="button">生成效果图</button>
                        <button id="nsd_f_scheme_del" class="nsd-btn" type="button">删除</button>
                    </div>
                    <div class="nsd-label">已保存方案（点击图片切换）</div>
                    <div id="nsd_scheme_grid" class="nsd-scheme-grid"></div>
                </section>

                <section class="nsd-tab-pane" data-nsd-pane="params">
                    <div class="nsd-row nsd-compact">
                        <label>采样器
                            <select id="nsd_f_sampler" class="text_pole">
                                <option value="k_euler_ancestral">Euler Ancestral</option>
                                <option value="k_euler">Euler</option>
                                <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                                <option value="k_dpmpp_2m">DPM++ 2M</option>
                                <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                                <option value="k_dpmpp_sde">DPM++ SDE</option>
                                <option value="ddim_v3">DDIM</option>
                            </select>
                        </label>
                    </div>
                    <div class="nsd-row nsd-compact">
                        <label>噪点表
                            <select id="nsd_f_noise" class="text_pole">
                                <option value="karras">karras</option>
                                <option value="native">native</option>
                                <option value="exponential">exponential</option>
                                <option value="polyexponential">polyexponential</option>
                            </select>
                        </label>
                    </div>
                    <div class="nsd-row nsd-compact">
                        <label>尺寸
                            <select id="nsd_f_size" class="text_pole">
                                <option value="832x1216">竖 832×1216</option>
                                <option value="1216x832">横 1216×832</option>
                                <option value="1024x1024">方 1024×1024</option>
                                <option value="1024x1536">大竖 1024×1536</option>
                                <option value="1536x1024">大横 1536×1024</option>
                                <option value="custom">自定义</option>
                            </select>
                        </label>
                    </div>
                    <div class="nsd-row nsd-compact">
                        <label>宽 <input id="nsd_f_width" class="text_pole" type="number" min="64" step="64" /></label>
                        <label>高 <input id="nsd_f_height" class="text_pole" type="number" min="64" step="64" /></label>
                    </div>
                    <div class="nsd-row nsd-compact">
                        <label>步数 <input id="nsd_f_steps" class="text_pole" type="number" min="1" max="50" /></label>
                        <label>CFG <input id="nsd_f_scale" class="text_pole" type="number" min="1" max="20" step="0.1" /></label>
                    </div>
                    <div class="nsd-row nsd-compact">
                        <label>CFG Rescale <input id="nsd_f_cfg_rescale" class="text_pole" type="number" min="0" max="1" step="0.05" /></label>
                        <label>张数 <input id="nsd_f_n_samples" class="text_pole" type="number" min="1" max="4" /></label>
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_seed">种子（-1 随机）</label>
                        <input id="nsd_f_seed" class="text_pole" type="number" />
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_uc">UC Preset</label>
                        <select id="nsd_f_uc" class="text_pole">
                            <option value="0">Heavy</option>
                            <option value="1">Light</option>
                            <option value="2">Human Focus</option>
                            <option value="3">None</option>
                        </select>
                    </div>
                    <label class="checkbox_label"><input id="nsd_f_quality" type="checkbox" /> Quality Toggle</label>
                    <label class="checkbox_label"><input id="nsd_f_variety" type="checkbox" /> Variety</label>
                    <label class="checkbox_label"><input id="nsd_f_smea" type="checkbox" /> Auto SMEA</label>
                    <p class="nsd-hint">正面 / 后置 / 负向在「画师串」方案里保存和切换。</p>
                </section>

                <section class="nsd-tab-pane" data-nsd-pane="char">
                    <p class="nsd-hint">身份证每张图都带，不要写表情 / 洞 / 脱鞋。</p>
                    <div class="nsd-field">
                        <label for="nsd_f_identity">角色身份证</label>
                        <textarea id="nsd_f_identity" class="text_pole nsd-id-box" rows="6" placeholder="1girl, milf, huge breasts, wide hips, wedding ring, long hair, brown eyes"></textarea>
                    </div>
                </section>

                <section class="nsd-tab-pane" data-nsd-pane="setup">
                    <div class="nsd-field">
                        <label for="nsd_f_token">NovelAI Token</label>
                        <input id="nsd_f_token" class="text_pole" type="password" autocomplete="off" />
                    </div>
                    <div class="nsd-field">
                        <label for="nsd_f_api">API 地址</label>
                        <input id="nsd_f_api" class="text_pole" type="text" />
                    </div>
                    <label class="checkbox_label"><input id="nsd_f_proxy" type="checkbox" /> 走服务端代理</label>
                    <label class="checkbox_label"><input id="nsd_f_llm" type="checkbox" /> 用聊天模型译情景</label>
                    <label class="checkbox_label"><input id="nsd_f_auto" type="checkbox" /> 回复后自动出图</label>
                    <div class="nsd-actions">
                        <button id="nsd_f_test" class="nsd-btn nsd-btn-ghost" type="button">测试连接</button>
                    </div>
                </section>
            </div>
        </div>
    </div>`;

    function applySizePreset(key) {
        const s = getSettings();
        s.sizePreset = key;
        const pair = SIZE_PRESETS[key];
        if (pair) {
            s.width = pair[0];
            s.height = pair[1];
            const w = document.getElementById('nsd_width');
            const h = document.getElementById('nsd_height');
            if (w) w.value = s.width;
            if (h) h.value = s.height;
            const fw = document.getElementById('nsd_f_width');
            const fh = document.getElementById('nsd_f_height');
            if (fw) fw.value = s.width;
            if (fh) fh.value = s.height;
        }
        saveSettings();
    }

    function syncSizePresetFromWH() {
        const s = getSettings();
        const key = `${Number(s.width)}x${Number(s.height)}`;
        s.sizePreset = SIZE_PRESETS[key] ? key : 'custom';
        const sel = document.getElementById('nsd_size_preset');
        const fsel = document.getElementById('nsd_f_size');
        if (sel) sel.value = s.sizePreset;
        if (fsel) fsel.value = s.sizePreset;
        saveSettings();
    }

    function bindSizePreset() {
        const sel = document.getElementById('nsd_size_preset');
        if (sel) {
            sel.value = getSettings().sizePreset || '832x1216';
            sel.addEventListener('change', () => applySizePreset(sel.value));
        }
        ['nsd_width', 'nsd_height'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', syncSizePresetFromWH);
        });
    }

    function uid() {
        return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function currentScheme() {
        const s = getSettings();
        return (s.schemes || []).find(x => x.id === s.activeSchemeId) || null;
    }

    function fillPromptFields(s) {
        const map = {
            nsd_artist: s.artist,
            nsd_f_artist: s.artist,
            nsd_f_scheme_artist: s.artist,
            nsd_prefix: s.commonPrefix,
            nsd_suffix: s.suffix,
            nsd_negative: s.negative,
            nsd_f_scheme_suffix: s.suffix,
            nsd_f_scheme_negative: s.negative,
        };
        for (const [id, v] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el && document.activeElement !== el) el.value = v || '';
        }
    }

    function applyScheme(id) {
        const s = getSettings();
        const sc = (s.schemes || []).find(x => x.id === id);
        if (!sc) return;
        s.activeSchemeId = id;
        s.artist = sc.artist || sc.prefix || '';
        if (sc.prefix) s.commonPrefix = sc.prefix;
        if (sc.suffix != null) s.suffix = sc.suffix;
        if (sc.negative != null) s.negative = sc.negative;
        saveSettings();
        fillPromptFields(s);
        const n = document.getElementById('nsd_f_scheme_name');
        if (n) n.value = sc.name || '';
        const sel = document.getElementById('nsd_f_scheme');
        if (sel) sel.value = id;
        renderSchemeGrid();
        updateFloatStatus();
        toast('success', '已切换方案：' + (sc.name || '未命名'));
    }

    function renderSchemeSelect() {
        const s = getSettings();
        const sel = document.getElementById('nsd_f_scheme');
        if (!sel) return;
        const cur = s.activeSchemeId;
        sel.innerHTML = (s.schemes || []).map(sc =>
            `<option value="${sc.id}">${(sc.name || '未命名').replace(/[<>&]/g, '')}</option>`
        ).join('') || '<option value="">（还没有方案）</option>';
        if (cur) sel.value = cur;
    }

    function renderSchemeGrid() {
        const box = document.getElementById('nsd_scheme_grid');
        if (!box) return;
        const s = getSettings();
        const list = s.schemes || [];
        if (!list.length) {
            box.innerHTML = '<p class="nsd-hint">还没有保存的方案。填正面 / 后置 / 负向后点「新建 / 保存」，再点「生成效果图」。</p>';
            return;
        }
        box.innerHTML = list.map(sc => {
            const on = sc.id === s.activeSchemeId ? ' is-on' : '';
            const img = sc.preview
                ? `<img src="${sc.preview}" alt="${sc.name || ''}">`
                : '<div class="nsd-scheme-ph">无效果图</div>';
            return `<button type="button" class="nsd-scheme-card${on}" data-scheme="${sc.id}">${img}<span>${(sc.name || '未命名').replace(/[<>&]/g, '')}</span></button>`;
        }).join('');
        box.querySelectorAll('.nsd-scheme-card').forEach(btn => {
            btn.addEventListener('click', () => applyScheme(btn.getAttribute('data-scheme')));
        });
    }

    function readSchemePrompts() {
        const s = getSettings();
        const artist = (document.getElementById('nsd_f_scheme_artist')?.value
            || document.getElementById('nsd_f_artist')?.value
            || s.artist || '').trim();
        const suffix = (document.getElementById('nsd_f_scheme_suffix')?.value
            ?? s.suffix ?? '').trim();
        const negative = (document.getElementById('nsd_f_scheme_negative')?.value
            ?? s.negative ?? '').trim();
        return { artist, suffix, negative };
    }

    function saveCurrentScheme(asNew) {
        const s = getSettings();
        const name = (document.getElementById('nsd_f_scheme_name')?.value || '').trim() || '未命名';
        const { artist, suffix, negative } = readSchemePrompts();
        if (!artist && !suffix) {
            toast('warning', '正面和后置都是空的，先填再保存');
            return;
        }
        const payload = { name, artist, prefix: artist, suffix, negative };
        if (asNew || !s.activeSchemeId) {
            const sc = { id: uid(), preview: '', ...payload };
            s.schemes.push(sc);
            s.activeSchemeId = sc.id;
        } else {
            const sc = currentScheme();
            if (!sc) {
                const neu = { id: uid(), preview: '', ...payload };
                s.schemes.push(neu);
                s.activeSchemeId = neu.id;
            } else {
                Object.assign(sc, payload);
            }
        }
        s.artist = artist;
        s.commonPrefix = artist || s.commonPrefix;
        s.suffix = suffix;
        s.negative = negative;
        saveSettings();
        fillPromptFields(s);
        renderSchemeSelect();
        renderSchemeGrid();
        updateFloatStatus();
        toast('success', '方案已保存（含后置正 / 反提示词）');
    }

    function deleteCurrentScheme() {
        const s = getSettings();
        if (!s.activeSchemeId) {
            toast('info', '没有选中的方案');
            return;
        }
        s.schemes = (s.schemes || []).filter(x => x.id !== s.activeSchemeId);
        s.activeSchemeId = s.schemes[0]?.id || '';
        if (s.schemes[0]) {
            const sc = s.schemes[0];
            s.artist = sc.artist || sc.prefix || '';
            if (sc.suffix != null) s.suffix = sc.suffix;
            if (sc.negative != null) s.negative = sc.negative;
        }
        saveSettings();
        renderSchemeSelect();
        renderSchemeGrid();
        syncFloatNaiFields();
        toast('info', '方案已删除');
    }

    async function generateSchemePreview() {
        const s = getSettings();
        const { artist, suffix, negative } = readSchemePrompts();
        if (!artist && !suffix) {
            toast('warning', '先填正面或后置再生成效果图');
            return;
        }
        if (!s.activeSchemeId) saveCurrentScheme(true);
        const tags = (document.getElementById('nsd_f_preview_tags')?.value || s.previewTags || '').trim();
        const identity = getIdentity() || '1girl, milf, huge breasts, wide hips';
        const built = {
            identity,
            base: [artist, tags, suffix].filter(Boolean).join(', '),
            charPrompt: [identity, 'ahegao, rolling eyes, tongue out, open mouth, drooling'].filter(Boolean).join(', '),
            scene: tags,
            negative: negative || s.negative,
            rows: [{ id: 'ahegao' }],
        };
        toast('info', '正在生成方案效果图…');
        setBusy(true);
        try {
            const dataUrl = await callNai(built);
            const sc = currentScheme();
            if (sc) {
                sc.preview = dataUrl;
                sc.artist = artist;
                sc.prefix = artist;
                sc.suffix = suffix;
                sc.negative = negative;
                s.artist = artist;
                s.suffix = suffix;
                s.negative = negative;
                saveSettings();
            }
            renderSchemeGrid();
            toast('success', '效果图已更新，点击即可切换');
        } catch (e) {
            toast('error', e.message || String(e));
        } finally {
            setBusy(false);
        }
    }

    function syncFloatNaiFields() {
        const s = getSettings();
        const val = {
            nsd_f_model: s.model,
            nsd_f_sampler: s.sampler,
            nsd_f_steps: s.steps,
            nsd_f_scale: s.scale,
            nsd_f_seed: s.seed,
            nsd_f_size: s.sizePreset,
            nsd_f_noise: s.noiseSchedule,
            nsd_f_cfg_rescale: s.cfgRescale,
            nsd_f_n_samples: s.nSamples,
            nsd_f_width: s.width,
            nsd_f_height: s.height,
            nsd_f_uc: s.ucPreset,
            nsd_f_artist: s.artist,
            nsd_f_scheme_artist: s.artist,
            nsd_f_scheme_suffix: s.suffix,
            nsd_f_scheme_negative: s.negative,
            nsd_f_preview_tags: s.previewTags,
            nsd_f_api: s.apiBase,
            nsd_f_token: s.apiToken,
        };
        for (const [id, v] of Object.entries(val)) {
            const el = document.getElementById(id);
            if (!el || document.activeElement === el) continue;
            el.value = v ?? '';
        }
        const chk = {
            nsd_f_quality: s.qualityToggle !== false,
            nsd_f_variety: !!s.variety,
            nsd_f_smea: !!s.autoSmea,
            nsd_f_proxy: !!s.useProxy,
            nsd_f_llm: !!s.useLlmScene,
            nsd_f_auto: !!s.autoGenerate,
        };
        for (const [id, v] of Object.entries(chk)) {
            const el = document.getElementById(id);
            if (el) el.checked = v;
        }
        const sc = currentScheme();
        const n = document.getElementById('nsd_f_scheme_name');
        if (n && document.activeElement !== n) n.value = sc?.name || '';
        renderSchemeSelect();
        renderSchemeGrid();
    }

    function bindSettings() {
        bindValue('nsd_token', 'apiToken', false);
        bindValue('nsd_api_base', 'apiBase', false);
        bindValue('nsd_model', 'model', false);
        bindValue('nsd_width', 'width', true);
        bindValue('nsd_height', 'height', true);
        bindValue('nsd_steps', 'steps', true);
        bindValue('nsd_scale', 'scale', true);
        bindValue('nsd_sampler', 'sampler', false);
        bindValue('nsd_noise_schedule', 'noiseSchedule', false);
        bindValue('nsd_cfg_rescale', 'cfgRescale', true);
        bindValue('nsd_n_samples', 'nSamples', true);
        bindValue('nsd_seed', 'seed', true);
        bindValue('nsd_uc_preset', 'ucPreset', true);
        bindValue('nsd_size_preset', 'sizePreset', false);
        bindValue('nsd_prefix', 'commonPrefix', false);
        bindValue('nsd_suffix', 'suffix', false);
        bindValue('nsd_artist', 'artist', false);
        bindValue('nsd_negative', 'negative', false);
        bindCheckbox('nsd_use_proxy', 'useProxy');
        bindCheckbox('nsd_use_llm', 'useLlmScene');
        bindCheckbox('nsd_auto', 'autoGenerate');
        bindCheckbox('nsd_show_float', 'showFloat');
        bindCheckbox('nsd_quality_toggle', 'qualityToggle');
        bindCheckbox('nsd_variety', 'variety');
        bindCheckbox('nsd_auto_smea', 'autoSmea');
        bindSizePreset();
        syncFloatNaiFields();

        document.getElementById('nsd_show_float')?.addEventListener('change', updateFloatStatus);
        document.getElementById('nsd_use_proxy')?.addEventListener('change', updateFloatStatus);
        document.getElementById('nsd_model')?.addEventListener('change', () => {
            const m2 = document.getElementById('nsd_f_model');
            if (m2) m2.value = getSettings().model;
            updateFloatStatus();
        });
        document.getElementById('nsd_token')?.addEventListener('change', updateFloatStatus);

        const idEl = document.getElementById('nsd_identity');
        if (idEl) {
            idEl.value = getIdentity();
            const persist = () => setIdentity(idEl.value);
            idEl.addEventListener('change', persist);
            idEl.addEventListener('blur', persist);
            idEl.addEventListener('input', () => {
                const fEl = document.getElementById('nsd_f_identity');
                if (fEl && document.activeElement !== fEl) fEl.value = idEl.value;
            });
        }

        document.getElementById('nsd_btn_open_float')?.addEventListener('click', () => {
            getSettings().showFloat = true;
            saveSettings();
            const box = document.getElementById('nsd_show_float');
            if (box) box.checked = true;
            mountFloat().then(() => openPanel()).catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_btn_preview')?.addEventListener('click', () => {
            generateNow(true).catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_btn_gen')?.addEventListener('click', () => {
            generateNow(false).catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_btn_test')?.addEventListener('click', async () => {
            try {
                const s = getSettings();
                if (!s.apiToken) throw new Error('没填 Token');
                if (s.useProxy) {
                    const res = await fetch(PROXY_PING, { headers: requestHeaders() });
                    if (!res.ok) throw new Error(`代理 ${res.status}：服务端插件未安装或未开启`);
                    const json = await res.json().catch(() => ({}));
                    toast('success', json.ok ? '服务端插件在线' : JSON.stringify(json));
                    return;
                }
                toast('info', '直连模式无法在浏览器里可靠测通，失败时请改用服务端代理。');
            } catch (e) {
                toast('error', e.message || String(e));
            }
        });
    }

    function switchTab(name) {
        document.querySelectorAll('#nsd_float_root .nsd-tab').forEach(el => {
            el.classList.toggle('is-on', el.getAttribute('data-nsd-tab') === name);
        });
        document.querySelectorAll('#nsd_float_root .nsd-tab-pane').forEach(el => {
            el.classList.toggle('is-on', el.getAttribute('data-nsd-pane') === name);
        });
    }

    async function mountFloat() {
        if (document.getElementById('nsd_launcher')) return;
        const wrap = document.createElement('div');
        wrap.id = 'nsd_float_root';
        wrap.innerHTML = FLOAT_HTML;
        document.body.appendChild(wrap);

        const launcher = document.getElementById('nsd_launcher');
        const overlay = document.getElementById('nsd_overlay');
        applyLauncherPos();
        applyPanelPos();
        enableDrag(launcher, launcher, 'launcherX', 'launcherY');

        launcher?.addEventListener('click', (ev) => {
            if (launcher.dataset.nsdDragged === '1') {
                launcher.dataset.nsdDragged = '0';
                return;
            }
            const s = getSettings();
            if (s.panelOpen) hidePanel();
            else openPanel();
            ev.preventDefault();
        });
        document.getElementById('nsd_btn_hide')?.addEventListener('click', hidePanel);
        overlay?.addEventListener('click', (ev) => {
            if (ev.target === overlay) hidePanel();
        });
        document.querySelectorAll('#nsd_float_root .nsd-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.getAttribute('data-nsd-tab')));
        });

        const fId = document.getElementById('nsd_f_identity');
        if (fId) {
            fId.value = getIdentity();
            const persist = () => {
                setIdentity(fId.value);
                const idEl = document.getElementById('nsd_identity');
                if (idEl) idEl.value = fId.value;
            };
            fId.addEventListener('change', persist);
            fId.addEventListener('blur', persist);
        }

        const fModel = document.getElementById('nsd_f_model');
        if (fModel) {
            fModel.value = getSettings().model;
            fModel.addEventListener('change', () => {
                getSettings().model = fModel.value;
                saveSettings();
                const m1 = document.getElementById('nsd_model');
                if (m1) m1.value = fModel.value;
                updateFloatStatus();
            });
        }
        const bindFloatVal = (id, key, numeric, extra) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = getSettings()[key] ?? '';
            el.addEventListener('change', () => {
                getSettings()[key] = numeric ? Number(el.value) : el.value;
                saveSettings();
                if (typeof extra === 'function') extra(el.value);
                const mirror = document.getElementById({
                    sampler: 'nsd_sampler',
                    steps: 'nsd_steps',
                    scale: 'nsd_scale',
                    seed: 'nsd_seed',
                    sizePreset: 'nsd_size_preset',
                }[key] || '');
                if (mirror) mirror.value = el.value;
            });
        };
        bindFloatVal('nsd_f_sampler', 'sampler', false);
        bindFloatVal('nsd_f_steps', 'steps', true);
        bindFloatVal('nsd_f_scale', 'scale', true);
        bindFloatVal('nsd_f_seed', 'seed', true);
        bindFloatVal('nsd_f_size', 'sizePreset', false, (v) => applySizePreset(v));
        bindFloatVal('nsd_f_noise', 'noiseSchedule', false);
        bindFloatVal('nsd_f_cfg_rescale', 'cfgRescale', true);
        bindFloatVal('nsd_f_n_samples', 'nSamples', true);
        bindFloatVal('nsd_f_width', 'width', true, () => syncSizePresetFromWH());
        bindFloatVal('nsd_f_height', 'height', true, () => syncSizePresetFromWH());
        bindFloatVal('nsd_f_uc', 'ucPreset', true);
        bindFloatVal('nsd_f_artist', 'artist', false);
        bindFloatVal('nsd_f_preview_tags', 'previewTags', false);
        const bindSchemePrompt = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                getSettings()[key] = el.value;
                saveSettings();
                const mirrors = {
                    artist: ['nsd_artist', 'nsd_f_artist', 'nsd_prefix'],
                    suffix: ['nsd_suffix'],
                    negative: ['nsd_negative'],
                }[key] || [];
                mirrors.forEach(mid => {
                    const m = document.getElementById(mid);
                    if (m && document.activeElement !== m) m.value = el.value;
                });
            });
        };
        bindSchemePrompt('nsd_f_scheme_artist', 'artist');
        bindSchemePrompt('nsd_f_scheme_suffix', 'suffix');
        bindSchemePrompt('nsd_f_scheme_negative', 'negative');
        bindFloatVal('nsd_f_api', 'apiBase', false);
        bindFloatVal('nsd_f_token', 'apiToken', false);
        const bindFloatChk = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !!getSettings()[key];
            el.addEventListener('change', () => {
                getSettings()[key] = el.checked;
                saveSettings();
                const mirror = {
                    qualityToggle: 'nsd_quality_toggle',
                    variety: 'nsd_variety',
                    autoSmea: 'nsd_auto_smea',
                    useProxy: 'nsd_use_proxy',
                    useLlmScene: 'nsd_use_llm',
                    autoGenerate: 'nsd_auto',
                }[key];
                const m = mirror && document.getElementById(mirror);
                if (m) m.checked = el.checked;
                updateFloatStatus();
            });
        };
        bindFloatChk('nsd_f_quality', 'qualityToggle');
        bindFloatChk('nsd_f_variety', 'variety');
        bindFloatChk('nsd_f_smea', 'autoSmea');
        bindFloatChk('nsd_f_proxy', 'useProxy');
        bindFloatChk('nsd_f_llm', 'useLlmScene');
        bindFloatChk('nsd_f_auto', 'autoGenerate');
        document.getElementById('nsd_f_scheme')?.addEventListener('change', (ev) => applyScheme(ev.target.value));
        document.getElementById('nsd_f_scheme_new')?.addEventListener('click', () => {
            getSettings().activeSchemeId = '';
            const n = document.getElementById('nsd_f_scheme_name');
            if (n) n.value = '';
            saveCurrentScheme(true);
        });
        document.getElementById('nsd_f_scheme_save')?.addEventListener('click', () => saveCurrentScheme(false));
        document.getElementById('nsd_f_scheme_del')?.addEventListener('click', deleteCurrentScheme);
        document.getElementById('nsd_f_scheme_preview')?.addEventListener('click', () => {
            generateSchemePreview().catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_f_scheme_artist')?.addEventListener('input', () => {
            const v = document.getElementById('nsd_f_scheme_artist').value;
            const a = document.getElementById('nsd_f_artist');
            if (a && document.activeElement !== a) a.value = v;
        });
        document.getElementById('nsd_f_scheme_suffix')?.addEventListener('input', () => {
            getSettings().suffix = document.getElementById('nsd_f_scheme_suffix').value;
        });
        document.getElementById('nsd_f_scheme_negative')?.addEventListener('input', () => {
            getSettings().negative = document.getElementById('nsd_f_scheme_negative').value;
        });
        syncFloatNaiFields();

        document.getElementById('nsd_f_preview')?.addEventListener('click', () => {
            generateNow(true).catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_f_gen')?.addEventListener('click', () => {
            generateNow(false).catch(e => toast('error', e.message || String(e)));
        });
        document.getElementById('nsd_f_test')?.addEventListener('click', () => {
            document.getElementById('nsd_btn_test')?.click();
        });

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && getSettings().panelOpen) hidePanel();
        });
        window.addEventListener('resize', () => {
            applyPanelPos();
            applyLauncherPos();
        });
    }

    async function registerSlash() {
        const help = 'NAI 情景生图。/nimg 出图，/nimg dry 预览，/nimg freeze 标签 写身份证。';
        const callback = async (_named, unnamed) => {
            const v = String(unnamed ?? '').trim();
            if (v.startsWith('freeze ')) {
                await setIdentity(v.slice(7));
                reloadIdentityField();
                return '身份证已更新';
            }
            if (v === 'ui' || v === '面板') {
                openPanel();
                return 'opened';
            }
            if (v === 'dry' || v === '预览') {
                await generateNow(true);
                return 'preview';
            }
            await generateNow(false);
            return 'ok';
        };

        try {
            const parserMod = await import('../../../slash-commands/SlashCommandParser.js');
            const cmdMod = await import('../../../slash-commands/SlashCommand.js');
            const argMod = await import('../../../slash-commands/SlashCommandArgument.js');
            parserMod.SlashCommandParser.addCommandObject(cmdMod.SlashCommand.fromProps({
                name: 'nimg',
                aliases: ['nai图'],
                callback,
                unnamedArgumentList: [
                    argMod.SlashCommandArgument.fromProps({
                        description: '空=出图；dry=预览；ui=打开面板；freeze 标签=写入身份证',
                        typeList: [argMod.ARGUMENT_TYPE.STRING],
                        isRequired: false,
                    }),
                ],
                helpString: help,
            }));
            return;
        } catch (err) {
            console.warn(`[${MODULE}] new slash API unavailable`, err);
        }

        const c = ctx();
        if (typeof c.registerSlashCommand === 'function') {
            c.registerSlashCommand('nimg', callback, ['nai图'], help, true, true);
        }
    }

    function hookEvents() {
        const c = ctx();
        const src = c.eventSource;
        const types = c.eventTypes || c.event_types || {};
        if (!src || typeof src.on !== 'function') return;

        if (types.CHAT_CHANGED) src.on(types.CHAT_CHANGED, () => { reloadIdentityField(); refreshSceneChips(); });
        if (types.CHARACTER_EDITED) src.on(types.CHARACTER_EDITED, reloadIdentityField);
        if (types.MESSAGE_RECEIVED) src.on(types.MESSAGE_RECEIVED, refreshSceneChips);
        if (types.MESSAGE_SENT) src.on(types.MESSAGE_SENT, refreshSceneChips);
        if (types.CHARACTER_MESSAGE_RENDERED) src.on(types.CHARACTER_MESSAGE_RENDERED, refreshSceneChips);

        const received = types.MESSAGE_RECEIVED;
        if (received) {
            src.on(received, async (idx) => {
                if (!getSettings().autoGenerate) return;
                const mes = ctx().chat?.[idx];
                if (!mes || mes.is_user || mes.is_system) return;
                try {
                    await generateNow(false);
                } catch (e) {
                    toast('error', e.message || String(e));
                }
            });
        }
    }

    async function boot() {
        try {
            const html = await loadTemplate('settings');
            const $host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
            $host.append(html);
            bindSettings();
        } catch (err) {
            console.error(`[${MODULE}] settings template failed`, err);
        }
        try {
            await mountFloat();
        } catch (err) {
            console.error(`[${MODULE}] float failed`, err);
            toast('error', '悬浮窗加载失败：' + (err.message || err));
        }
        hookEvents();
        try { await registerSlash(); } catch (err) {
            console.warn(`[${MODULE}] slash failed`, err);
        }
        updateFloatStatus();
        refreshSceneChips();
        console.log(`[${MODULE}] loaded`);
    }

    if (window.jQuery) {
        jQuery(boot);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
