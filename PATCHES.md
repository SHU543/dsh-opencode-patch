# 本 Fork 的改动

基线：`dsh-opencode-patch@1.4.1`（上游 <https://github.com/viztor/dsh-opencode-patch>，MIT）。

本 fork 只改 `lib/index.mjs`（宿主）与 `lib/client.js`（前端），未改协议逻辑、未加依赖、未改上游任何数据。

---

## 1. 修复：非 ASCII 工作区名导致 `Connection error`（**最关键**）

**症状**：模型能选中，一发消息就 `TRANSPORT Connection error`，重试 5 次全败，且补丁的 debug 日志里**看不到任何对话请求**。

**根因**：补丁把工作区目录名原样写进 HTTP 头 `x-opencode-project`。HTTP 头只能是 Latin-1 字节，目录名含中文（如 `默认工作区D`）时，Node 的 undici 在构造请求时抛：

```
TypeError: Cannot convert argument to a ByteString because the character
at index 0 has a value of 40664 which is greater than 255
```

该异常发生在 `await fetch(...)`，而补丁的 debug 记录写在 fetch **成功之后**，所以请求"凭空消失"。curl 不做这个校验，因此命令行测不出来——这是它长期难定位的原因。

**修复**（`lib/index.mjs`，`x-opencode-project` 注入处）：非 ASCII 一律百分号编码。

```js
headers.set("x-opencode-project",
  /^[\x20-\x7e]*$/.test(project) ? project : encodeURIComponent(project));
```

---

## 2. 修复：API key 只从环境变量读取

**症状**：模型在选择器里不出现（付费模型被整批过滤）；即使出现也发不出请求。

**根因**：两处只读 `process.env.OPENCODE_GO_API_KEY`，不查 DSH 凭据服务。key 存在凭据库、环境变量没有时，补丁判定"无凭据"，随后把所有 `cost.input > 0` 的模型从列表剔除——表现为选择器空白。

**修复**（两处）：统一走 `resolveRef(ctx, ref)`——凭据服务优先、环境变量兜底、从不抛错；并新增"插件配置里的 key"为最高优先级。

- `hasPlaneCredential`：决定列表显示哪些模型
- `patchedFetch` 内的 key 兜底：决定请求带什么凭据

---

## 3. 新增：设置卡片可直接填 API 密钥

**原因**：上游刻意不给卡片放 key 输入框（它假定 key 在环境变量/凭据服务里）。对"key 只在别处、或凭据库被清空"的部署，用户没有入口。

**实现**：

- 宿主 schema 新增两个字段（`lib/index.mjs`）：
  - `apiKey` — 直接写在插件设置里，随每个请求发送
  - `apiKeyEnv` — 留空时回退用的凭据引用名（默认 `OPENCODE_GO_API_KEY`）
- 前端（`lib/client.js`）：新增 `TEXT_STYLE`、`SettingsTextField`（`type="password"` 的 input，套用宿主原有的 `SettingsFieldShell` 外壳），并在 `controlFor` 里加 `text` 分支。
  > 宿主的 `SettingsFormModel` 只内置 `boolean` / `select` 两种控件，自定义控件必须自己画——`kind: "text"` 若不加这个分支会被当成布尔渲染成开关。
- 中英文案：`apiKey` / `apiKeyHint`

---

## 已知限制

- **key 会明文落在** `cordis.patch.yml` 的 `apiKey:` 字段（插件设置存储）。介意的话改用凭据库：清空该字段，把 key 存进 `OPENCODE_GO_API_KEY` 凭据引用即可。
- 卡片里的 `apiKey` 与凭据库的 `OPENCODE_GO_API_KEY` 是**两份**，不会互相同步。
- 未验证：`@ai-sdk/mistral` 方言模型、Gemini 桥接路由在非 ASCII 项目名下的表现（同一处修复应已覆盖，但未实测）。

---

## 上游反馈建议

第 1、2 条是上游的真实缺陷，与本地环境无关，值得提 issue：

- 非 ASCII 项目名 → undici ByteString 异常（建议上游对 header 值统一做百分号编码或按字节安全序列化）
- 凭据解析只读 `process.env`（建议与同文件 `resolveRef` 保持一致）
