# nai-scene-draw server plugin

Optional SillyTavern **server plugin**. The UI extension can call NovelAI through this proxy so the browser does not hit CORS.

## Install

1. Copy this folder to:

```
<SillyTavern>/plugins/nai-scene-draw/
```

The file `index.js` must sit at `plugins/nai-scene-draw/index.js`.

2. In `config.yaml`:

```yaml
enableServerPlugins: true
```

3. Restart SillyTavern.

4. In the UI extension, enable **走酒馆服务端插件代理** and click 测试连接.

Routes:

- `GET  /api/plugins/nai-scene-draw/ping`
- `POST /api/plugins/nai-scene-draw/generate`
