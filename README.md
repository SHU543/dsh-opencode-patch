# dsh-opencode-patch（修正版 fork）

让 **OpenCode Zen / Go** 模型在 DeepSeek Harness 里正常工作的插件 —— 补 session id、补网关请求头、按模型分流协议、显示 Go 配额。

本仓库是 [viztor/dsh-opencode-patch](https://github.com/viztor/dsh-opencode-patch) **1.4.1** 的修正版，修掉了三个会导致"模型看不见 / 一发消息就 Connection error"的缺陷，并新增了设置卡片里直接填 API 密钥。

> 上游 MIT，本 fork 同样 MIT。改动仅涉及 `lib/index.mjs` 与 `lib/client.js`，未改协议逻辑、未加依赖。

---

## 装

```bash
dsh plugin --profile <profile> add github:SHU543/dsh-opencode-patch
```

或本地 tarball：

```bash
dsh plugin add file:<dsh-opencode-patch-1.4.2-fix.1.tgz 的绝对路径>
```

装完**重启 DSH**，然后在 **设置 → 插件 → OpenCode 补丁** 里填 API 密钥。

完整步骤（含必须的 provider 声明）见 **[INSTALL.md](./INSTALL.md)**。

---

## 修了什么

| # | 问题 | 症状 |
|---|---|---|
| 1 | **非 ASCII 工作区名导致崩溃** | 模型能选中，一发消息就 `Connection error`，且日志里查不到请求 |
| 2 | **key 只读环境变量，不查凭据库** | 模型在选择器里整批消失 |
| 3 | **新增**：设置卡片可填 API 密钥 | 上游没有 key 输入入口 |

第 1 条的根因特别隐蔽：插件把工作区目录名原样塞进 HTTP 头 `x-opencode-project`，目录名含中文时 Node 的 undici 直接抛 `TypeError: Cannot convert argument to a ByteString`。异常发生在 `fetch` 内部，而插件只在 fetch 成功后才写调试日志——所以请求"凭空消失"，命令行用 curl 也复现不出来。

逐条根因、代码和验证方式见 **[PATCHES.md](./PATCHES.md)**。

---

## 上游文档

原始 README 保留在 [README.upstream.md](./README.upstream.md) / [README.upstream.zh-CN.md](./README.upstream.zh-CN.md)，协议路由、配额表、配置项的详细说明都在那里。

---

## 已知限制

- `apiKey` 字段会**明文**写进 profile 的 `cordis.patch.yml`。介意就用凭据库（填 `apiKeyEnv` 指向的引用，把 `apiKey` 留空）。
- 卡片里的 `apiKey` 与凭据库中的引用是**两份**，不会同步。
- 插件只负责协议与请求头，**不替你声明模型** —— 必须在 `llm-pi-ai.providers` 里写 `opencode-go`，否则选择器仍然为空。
- 本 fork 与上游 npm 包同名，同时安装会冲突，请二选一。
