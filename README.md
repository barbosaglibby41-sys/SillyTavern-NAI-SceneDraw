# NAI 情景生图（锁外貌）

SillyTavern 第三方扩展：用 **NovelAI Diffusion 4.5 Full / 5 Full** 按最近剧情出图。

- **外貌锁死**：每个角色一张「身份证」（发、眼、胸臀、婚戒……），每张图都带，LLM 不许改。
- **情景开关**：阿嘿颜 / 脱鞋蒸汽 / 荣耀洞 只在最近正文真写到时才加整行标签。
- **正文不要写英文 tag**：扮演继续写中文；出图由词典（可选再用聊天模型翻译情景）完成。

> v1 先做到「身材/人种稳 + 表情跟剧情走」。同一张脸的 Character Reference 以后再加。

## 安装（酒馆里直接装）

1. 扩展 → **安装扩展** → 粘贴：

```
https://github.com/barbosaglibby41-sys/SillyTavern-NAI-SceneDraw
```

2. **完全重启**酒馆（关掉进程再开，不是只刷新网页）。
3. 扩展列表里打开 **NAI 情景生图（锁外貌）**。

更新：扩展管理里点更新，或重启时若 `auto_update` 开启会拉最新。

## 强烈建议：装服务端代理（避开 CORS）

浏览器直连 `image.novelai.net` 经常失败。把本仓库的代理拷进酒馆：

```
SillyTavern/plugins/nai-scene-draw/index.js
```

即：把仓库里的 `server-plugin/index.js` 放到上述路径（文件夹名必须是 `nai-scene-draw`）。

然后在酒馆 `config.yaml` 里：

```yaml
enableServerPlugins: true
```

再重启。扩展设置里勾上 **走酒馆服务端插件代理**，点「测试连接」应提示在线。

## 第一次使用

1. 填 **NovelAI Persistent API Token**（不要发到聊天里）。
2. 打开角色卡，填写 **当前角色身份证**，例如：

```
1girl, milf, mature female, huge breasts, wide hips, thick thighs, wedding ring, long black hair, brown eyes
```

不要把 `ahegao`、`glory hole`、`sweaty feet` 写进身份证。

3. 先点 **预览提示词**，确认：
   - 日常对话 → 本轮情景为空，负向里有 `ahegao`
   - 正文出现「翻白眼 / 刚脱鞋 / 墙洞」→ 才出现对应整行
4. 预览对了再点 **按最近剧情出图**，或在聊天输入 `/nimg`。

## 斜杠命令

| 命令 | 作用 |
|---|---|
| `/nimg` | 按最近 1～2 条正文出图 |
| `/nimg dry` | 只预览，不花额度 |
| `/nimg freeze 1girl, milf, ...` | 写入当前角色身份证 |
| `/nimg ui` | 打开悬浮窗 |

## 设置说明

| 项 | 建议 |
|---|---|
| 模型 | 定人优先 **4.5 Full**；5 Full 理解更好，锁脸未必更强 |
| 分辨率 | 默认 `832×1216` |
| 用聊天模型翻译情景 | 可选。失败会退回词典。它仍被禁止改外貌 |
| 角色回复后自动出图 | **默认关**。容易烧额度和画错表情 |

## 设计原则（不要改回去）

1. 扮演预设 / 世界书 **不要**让正文输出英文 tag。
2. 身份证常驻；阿嘿颜、足、洞全部 **keyed**，没写到就不加，并丢进负向。
3. 第二模型如果开着，只填空，不重写发色胸围。

## 文件

- `manifest.json` / `index.js` / `settings.html` / `style.css` — 酒馆 UI 扩展
- `server-plugin/index.js` — 可选 Node 代理（需单独拷到 `plugins/`）

MIT
�独拷到 `plugins/`）

MIT
