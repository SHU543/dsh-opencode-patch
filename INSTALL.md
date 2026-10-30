# 安装说明

这是一个修正版 fork，可直接被别人安装。三种方式任选。

> 安装前提：DSH profile 使用 `nodeLinker: hoisted`（DSH 默认 profile 即是）。

---

## 方式 A：从本地 tarball（离线分发，最省事）

把 `dsh-opencode-patch-1.4.2-fix.1.tgz` 发给对方，对方执行：

```bash
dsh plugin --profile <profile> add file:<tgz 的绝对路径>
```

Windows 路径示例：

```bash
dsh plugin add file:C:/Users/me/Downloads/dsh-opencode-patch-1.4.2-fix.1.tgz
```

装完**重启 DSH**。

---

## 方式 B：从 Git 仓库（发布后，最适合公开分享）

1. 把本目录推到自己的 GitHub 仓库（例如 `https://github.com/<你>/dsh-opencode-patch`）
2. 对方执行：

```bash
dsh plugin --profile <profile> add github:<你>/dsh-opencode-patch
```

`package.json` 里**已移除 `prepare` 脚本**（上游用 `vp run build`，从 git 安装时会因缺少 `src/` 而失败）。`lib/` 是预编译产物，不需要构建。

---

## 方式 C：发布到 npm

```bash
npm publish
```

注意：npm 上 `dsh-opencode-patch` 这个名字已被上游占用，直接发布会失败。两个选择：

- 加 scope：把 `package.json` 的 `name` 改成 `@<你的用户名>/dsh-opencode-patch`，并同步修改 `cordis.patch.yml` 的 `name`（必须等于包名）
- 或换个名字（同样要同步 `cordis.patch.yml`）

对方安装：

```bash
dsh plugin --profile <profile> add <包名>
```

---

## 安装后配置

重启后进 **设置 → 插件 → OpenCode 补丁**：

| 项 | 建议值 | 说明 |
|---|---|---|
| **API 密钥** | 填你的 key | 本 fork 新增。Go 的 key 形如 `sk-…`，Zen 形如 `oc_sk_…`，`type=password` |
| **API 端点** | 旧端点（`zen/v1`） | 新端点 `inference/…` 在部分账号上拉不到模型列表，旧端点两个接口都通 |
| **凭据来源** | 自动 | 会优先用上面填的 key |
| 读取 OpenCode 安装的密钥 | 关闭 | 保持默认 |

保存后重启 DSH，模型选择器里会出现 `opencode-go` 分组。

---

## 还要做的两件事

### 1. 声明 provider（否则选择器里没有模型）

插件只负责协议和请求头，**不替你声明模型**。在 profile 的 `cordis.patch.yml` 里，给 `llm-pi-ai` 的 `providers` 加：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        baseURL: https://opencode.ai/zen/go/v1
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash
            contextWindow: 1000000
            maxTokens: 384000
            input: [text, image]
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro (New)
            contextWindow: 1000000
            maxTokens: 384000
            input: [text]
        apiKeyEnv: OPENCODE_GO_API_KEY
```

### 2. key 存哪

`apiKeyEnv: OPENCODE_GO_API_KEY` 要求凭据库里有这个引用，否则 `llm-pi-ai` 会在发请求前就拒绝：

```
no credential for provider route "opencode-go"; its profile resolves
OPENCODE_GO_API_KEY, which is not set
```

二选一：

- 在 **设置 → 模型 → opencode-go → 编辑** 里填 API 密钥（写入凭据库）
- 或删掉 `apiKeyEnv` 那行，只靠插件卡片的 `apiKey`

---

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 选择器无 `opencode-go` 分组 | 没声明 provider | 见上面「声明 provider」 |
| `no credential … OPENCODE_GO_API_KEY` | 凭据库缺引用 | 填 key 或删 `apiKeyEnv` |
| `Connection error` + 日志无对话请求 | 旧版插件对非 ASCII 项目名崩溃 | 用本 fork（已修）；或把工作区目录改成纯 ASCII |
| 卡片「Go 用量」读不到配额 | key 无效或缺失 | 填对 key 后应显示三窗口数字 |
| 插件更新后修复失效 | `pnpm install` 按 lockfile 重装覆盖了 `lib/` | 重新打补丁或改用本 fork 的固定版本 |
