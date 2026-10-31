# 左下角额度矩阵（Quota Matrix）

本 fork 的底部额度展示：一张紧凑卡片，**行 = 厂商，列 = 时间档**，替换旧的
cost-meter 大卡片和 opencode-pool 浮层按钮。版式来自 Astra 与 Opus 两位顾问的评审，
两人都推荐把三列×三行转置为矩阵：档位标签只写一次，数值纵横对齐，缺档用 `—` 占位。

## 位置与版面

- 注册到 DSH 外壳的 `sidebar.footer.action` 槽（ui-sidebar 拥有，位于 Settings 座位旁），
  id `account-quota-footer`，order `0`。
- 展开侧栏时：一张 256px 宽、约 135px 高的卡片；rail 折叠时隐藏。
- 与「远程访问」按钮同槽：组件注入结构性 CSS 将槽改为 column，卡片占满宽度，按钮排在下方。
- 卡片内部是 4 列 grid（`70px + 3 × 1fr`）：
  - 表头：5h / 周 / 月，只写一次；最左格显示 **DeepSeek 官方账号余额**（如 `余额 ¥1.85`）；
  - 行：GPT / OpenCode Go / Claude，左侧厂商名 + 激活账号，右侧三档百分比与细条；
  - 底部状态行：默认显示最早重置的窗口；悬停任一格切换。

## 官方余额（头部左侧）

- 余额显示在表头原本空置的 identity 格，**不新增高度、不改动矩阵布局**。
- 数据与 DSH「设置 → 账号与余额」同源，通过浏览器端原生 `remote.account.getBalance`
  读取（`dsh-account-model-hub` 不接触 token、不新增宿主接口）；每 5 分钟刷新。
- 只显示充值 + 赠送钱包的合计；CNY 优先；未登录/读取失败时该格留空，不影响额度矩阵。

## 视觉与信息层级

- 厂商名 10.5px/600，账号 8.5px tertiary（截断，tooltip 完整）；
- 百分比 12px/600，等宽数字（tabular-nums），主信息；
- 档位表头 9px tertiary；
- 进度条统一 `#6aa9ff` 蓝色、高 3px；**所有时间档同色**（用户要求）；
- 轨道 `rgba(148,163,184,.22)`；卡片边距 6/8px，行高 30px，行间 0.5px 分隔线；
- 剩余 <15% 时仅把百分比改成 warning 色，条颜色不变（统一色下的预警让步）；
- 缺档单元格显示 `—`，不画条；grid 固定所以列永远对齐，不会留下断层。

## 交互

- 鼠标悬停任一百分比格（非点击）：该格浅高亮，底部状态行切换为
  “厂商 档位 · 重置 MM/DD HH:mm”；移出卡片恢复默认。
- 默认状态行显示所有激活账号中**最早的重置窗口**（例如 OpenCode 5h · 10/24 05:20）。
- 无窗口的 provider 不画条；未登录行显示 `未登录` / `—`。

## 激活账号（号池）

- 号池（`PoolAdapter`，`quota_aware` / `priority`，按会话粘性，`switchMargin` 控制切号）
  在某个 member 产出首块内容后，通过 `providers/pool-activity.ts` 记录
  `provider → account key`（仅展示，不参与路由）。
- `status` 端点携带 `activeAccount` 与 `preferredAccount`；额度矩阵优先显示手动指定的账号，
  其次才是最近实际服务的账号。没有指定/active 记录时回退：默认账号（直连路由）或额度最宽松的账号（OpenCode 多账号）。
- Host 重启清空 active 记录（preferred 已持久化）；登录/登出会清掉对应账号的旧记录。

## 账号池弹窗与手动切换

- 点击矩阵每行左侧的厂商名（GPT / OpenCode / Claude）打开账号池弹窗。
- 弹窗列出该 provider **全部已登录账号**，每张账号卡显示：
  - 账号名、plan、默认账号 / 正在使用 / 已指定标记；
  - 该账号所有额度窗口（5h/周/月及模型 scoped 窗口）的**剩余百分比、统一蓝色进度条、精确重置时间**；
  - Codex 可用重置额度数量（若返回）；同一 provider 下所有模型共用这些额度窗口。
- 操作：
  - **使用此账号**：写入 `~/.dsh/plugins/account-hub/pool-preferences.json` 的软指定；
  - **恢复自动选择**：删除该 provider 的指定，回到 quota-aware 调度；
  - **刷新额度**：强制向各账号 usage 端点取一次最新快照。
- 指定账号会立即在矩阵左侧显示，下一条池请求优先尝试它；若它冷却/额度耗尽，
  仍会自动回退其他账号（软 pin，不是硬绑定）。
- 打开弹窗时按需读取 `status` + 每账号 `usage`，不轮询；弹窗关闭即停止。

## 刷新

- 60 秒轮询 `subscriptions-auth.status` + `subscriptions-auth.usage`；页签隐藏时暂停，
  重新可见立即刷新。

## 与旧插件的关系

- 已停用 `dsh-cost-meter` 与 `dsh-opencode-go-pool`（pluginManager `setBundleEnabled(enabled:false)`，
  可随时重新启用）；旧额度卡与「OpenCode 号池」按钮消失，本插件接管展示。
- 不集成计费账本：只展示订阅额度窗口，不显示费用/余额。
- Codex 额度来自 `~/.codex/auth.json` 只读快照导入（设置页「导入 Codex CLI」），
  不会轮换 Codex CLI 的 refresh token。
