# OpenCode Go 接入（dsh-account-model-hub）

本文件记录本 fork 新增的 OpenCode Go 线：**为什么要单独一条路由、账号/额度怎么工作、三种协议怎么发、以及真机验证结果**。

## 1. 为什么路由 id 是 `opencode-go-hub`

DSH 自带一条 `opencode-go` 路由（`@deepseek-ai/dsh-llm-pi-ai` 的内置 provider，API key 认证）。
同一进程再注册同名 adapter 会被 `ctx.llm.registerAdapter` 拒绝，因此本插件用自己的 route id：

- 路由 id：`opencode-go-hub`（配置 `providers` / `models` 里用这个 id）
- 显示名：`OpenCode Go (Hub)`（模型选择器里看到的是显示名；官方 `opencode-go` 路由也叫 OpenCode Go，加 Hub 区分）
- 不使用 DSH 官方 `opencode-go` 路由，也不改它；两者可以并存，历史会话/默认模型不受影响。

## 2. 账号：API key 是长期凭据，不是 OAuth 会话

OpenCode Go 网关的推理认证是 `Authorization: Bearer <API key>`；没有可刷新的 OAuth refresh grant。
本插件的账号存储把每个 key 存成一条 account：

- 账号 key = `sha256(accessToken)` 的截断（永远不把 key 本身当账号 key/界面文本）；
- session 固定为 `{accessToken, refreshToken:'api-key', expiresAt:Number.MAX_SAFE_INTEGER, account?:label}`；
- 界面只显示用户备注（label）与 key 末 4 位；
- 不尝试 refresh：key 被吊销时是凭据失败（账号保留，方便替换 key），不是过期。

添加账号：**设置 → 账号与额度 → OpenCode Go**，填备注（可选）+ API Key，点「添加 API Key」。
Host 端保存到 `~/.dsh/plugins/account-hub/auth.json`（0600），key 不进入浏览器。

> 可选后续：OpenCode Console/Go 官方支持 OAuth 2.0 设备码（RFC 8628）登录，
> 参考实现 `grikomsn/pi-provider-opencode-console`。本版先以 API key 为主（稳定、无 refresh 竞态），
> OAuth 作为后续可选项。

## 3. 号池与路由

OpenCode Go 的账号自动进入本插件通用的账号池（与 GPT/Claude 共用一套 pool）：

- 策略：`priority`（顺序）或 `quota_aware`（按 5h/周/月窗口剩余量算 urgency）；
- 同一模型在多个账号上都可用时，按策略选一个执行，失败（QUOTA/AUTH）冷却后换号重试；
- 额度查询：`GET https://opencode.ai/inference/go/v1/usage`（旧 `zen/go/v1/usage` 自动迁移），
  返回 `{usage:{rolling,weekly,monthly}}`，映射为 5 小时 / 每周 / 每月窗口；
- 429 且 body 为 `GoUsageLimitError` / `usage limit exceeded` 时归类为 `QUOTA`（触发号池换号）；
  401/403 归类为凭据失败（不换号、不删账号）。

## 4. 三种上游协议与端点

OpenCode Go 网关是一个多协议根（默认 `https://opencode.ai/inference/go/v1`）。
模型目录来自 `@earendil-works/pi-ai` 的 `opencode-go` 数据（models.dev，快照 2026-10-24，
30 个模型），`src/providers/opencode-models.ts` 由 `scripts/generate-opencode-models.mjs` 生成。
按模型声明选择协议与端点：

| 协议 | 模型数 | 端点（默认网关） |
|---|---:|---|
| `openai-completions` | 23 | `https://opencode.ai/inference/go/openai/v1/chat/completions` |
| `openai-responses` | 5 | `https://opencode.ai/inference/go/openai/v1/responses` |
| `anthropic-messages` | 2 | `https://opencode.ai/inference/go/anthropic/v1/messages` |

- 所有请求带 `x-opencode-session` 路由头：优先复用会话语义；非 ASCII / 保留前缀的 id 用
  `sha256(utf16le) + base64url` 哈希（`dsh-go-session-v1-…`），无会话 id 时每次调用生成一个 UUID，
  同一次逻辑调用的多账号尝试共享同一个值（缓存/路由稳定）。
- 复用上游的翻译层（chat-completions / responses / anthropic 三套），支持文本、图片输入、
  工具调用与流式 reasoning。
- `models.dev` 的 `thinkingLevelMap` 映射为 DSH 可选择的 reasoning efforts（2026-10-24 修复）：
  - chat-completions：`reasoning_effort`，并处理 `thinkingFormat: deepseek`（`thinking.enabled/disabled`）
    与 `qwen`（`enable_thinking`）；
  - responses：`reasoning.effort`；
  - anthropic-messages：`thinking.budget_tokens`（minimal/medium/low/high 按 pi-ai 的预算阶梯，
    `xhigh`/`max` clamp 到 high），`off` 不发送 thinking；
  - 模型的真实 `thinkingLevelMap` 决定可选档位；`thinkingLevelMap` 缺省时按 pi-ai 默认档位
    （off/minimal/low/medium/high）显示。
  当前界面已验证：`qwen3.8-flash` 可选 Off/Minimal/Low/Medium/High，
  `deepseek-v4.1-flash` 可选 Low/High/Max；选择 High 后真实请求成功返回。

## 5. 与 `dsh-cost-meter` 的关系

不集成计费账本（本插件是订阅/账号管理，不是 API 计费）。额度在「账号与额度」页逐账号展示；
OpenCode Go 的 5h/周/月窗口来自官方 usage 端点。cost-meter 继续负责费用统计。

## 6. 真机验证（2026-10-24，DSH 0.2.1-rc.3）

用本机 OpenCode Go 账号 B（未在输出中打印 key）验证：

- usage：`GET /inference/go/v1/usage` → **200**，rolling/weekly/monthly 数值正常；
- 模型列表：`GET /inference/go/v1/models` → **200**，37 个 id（静态表 30 个 + 新发布 id，静态表是兜底）；
- 三个协议请求均返回 `400 MissingSessionID`（缺 `x-opencode-session` 时）→ 证明端点路径正确，
  且网关强制该头；带该头后：
  - `deepseek-v4.1-flash`（chat-completions）→ 成功出词 `OK`，usage 正常；
  - `grok-4.6`（openai-responses）→ 成功出词，usage 正常；
  - `qwen3.8-flash`（anthropic-messages）→ 成功出词，usage 正常。
- 离线回归：`pnpm test` 639/639 通过（含本 fork 新增的 `test/opencode.spec.ts`）。
- **GUI 真机验收**（2026-10-24）：
  - 设置 → 账号与额度：OpenCode Go 卡片显示 2 个账号与 5h/周/月窗口，API Key 表单可用；
  - 模型选择器出现 OpenCode Go 分组（30 个模型），选中 `Qwen3.8 Flash`（provider id
    `opencode-go-hub`）后新会话 3 秒回复「成功」；
  - 号池换号：调用前后账号 A 额度不变（周 100% 已限流），账号 B 5h 8%→10%、周 54%→55%，
    证明 quota-aware 号池在 A 限流时自动走 B；
  - 截图与记录见工作区 `account-hub/evidence/live/`（`gui-acceptance.md`、

## 7. 已知边界

- OpenCode 只支持 API key（本版）；OAuth 设备码是后续可选增强。
- 网关的 usage/模型接口不是公开稳定 API，变更时适配器需要跟着修；静态模型表会滞后于 `/models`，
  未知 id 可由用户在 `models.opencode-go-hub` 里显式添加。
- 多账号共用同一订阅服务可能受 OpenCode 服务条款约束。
