# 页面设计规范

> 历史材料：旧版本事实、路径和设计，不作为当前实施指令。

状态：`historical` · 标注：2026-09-12

当前版本：[../design/DESIGN.md](../design/DESIGN.md)。

> 三站（portal / forum / admin）重构后的视觉与交互基线。所有数值与条款来自权威标准与大厂官方文档（2026-09-12 核对），来源逐节列出。
> 技术版本基线见 [STACK.md](./STACK.md)。English: [DESIGN.en.md](./DESIGN.en.md)

---

## 0. 依据与适用范围

| 层 | 依据 | 性质 |
|---|---|---|
| 无障碍 | **WCAG 2.2 Level AA**（W3C Recommendation） | 强制 |
| 组件交互 | **WAI-ARIA Authoring Practices (APG)** | 强制（组件实现） |
| 中文排版 | **W3C clreq** + GB/T 15834—2011 | 强制（中文界面） |
| 视觉度量 | **Ant Design**（中文基准）+ Material Design 3 + Apple HIG | 参考，冲突时按 §5.6 取舍 |
| 状态与模式 | Ant Design + IBM Carbon | 参考 |

**验收基线**：WCAG 2.2 **AA 全量**；焦点样式按 `2.4.13 Focus Appearance`（AAA）设计。

> 注：`2.4.11` 是 AA，`2.4.13` 是 AAA；`3.2.6` 与 `3.3.7` 是 **Level A**（比 AA 更基础，不可忽略）。

---

## 1. 无障碍基线

### 1.1 必须达成的条款

| 编号 | 级别 | 硬性要求 | 本项目落点 |
|---|---|---|---|
| 1.4.3 Contrast (Minimum) | AA | 文本 **≥4.5:1**；大字号 **≥3:1**。大字号＝≥18pt 或 ≥14pt bold（CJK 等效 1.5em） | 校徽蓝作正文色、二级灰文本、占位符全部实测；禁用态可豁免 |
| 1.4.10 Reflow | AA | 320 CSS px 宽下无横向滚动 | 移动端与窄屏必测，含弹窗与表格 |
| 1.4.11 Non-text Contrast | AA | UI 组件与图形 **≥3:1** | 图标按钮、输入框边框、选中态 |
| 1.4.12 Text Spacing | AA | 用户覆盖行高 1.5×／段距 2×／字距 0.12×／词距 0.16× 时**不得丢内容** | **所有卡片用 `min-height` 而非固定 `height`**；禁止 `overflow: hidden` 截断 |
| 2.4.7 Focus Visible | AA | 键盘焦点指示可见 | 全局禁止无替代的 `outline: none`（失败案例 F78） |
| 2.4.11 Focus Not Obscured | AA | 焦点元素不得被**完全**遮住 | 粘性头部、`FeedbackFab` 悬浮层是风险点；滚动容器加 `scroll-padding` |
| 2.4.13 Focus Appearance | AAA | 焦点指示 ≥ 2px 厚周长，与相邻色 **≥3:1** | 焦点环统一 2px + 3:1，作为设计目标 |
| 2.5.7 Dragging Movements | AA | 拖拽操作必须能单指不拖拽完成 | 排序、滑块、拖拽上传（若有） |
| 2.5.8 Target Size (Minimum) | AA | 目标 **≥24×24 CSS px**，不足时 24px 直径圆不得相交 | 图标按钮、表格操作列、密集按钮；**句子内联链接可豁免** |
| 3.2.6 Consistent Help | A | 帮助入口在页面集合内**相对位置一致** | 三站「反馈/联系」入口不要换位 |
| 3.3.1 Error Identification | A | 错误必须**文本化**并指出字段 | 表单错误不能只靠红框 |
| 3.3.3 Error Suggestion | AA | 已知修正建议必须提供 | 邮箱/格式错误给出示例 |
| 3.3.7 Redundant Entry | A | 同流程不重复要求输入 | JoinByToken、邀请、反馈多步流程 |
| 3.3.8 Accessible Authentication | AA | 认证不得要求认知测试；支持密码管理器与粘贴 | 登录/注册；禁止纯记忆型验证 |
| 4.1.2 Name, Role, Value | A | 自定义组件名称/角色/状态可编程确定 | 手写组件的主要风险面 |
| 4.1.3 Status Messages | AA | 状态消息须能**不获得焦点**被辅助技术呈现 | 复制成功、提交结果、PoW 进度 |

WCAG 2.2 的 `4.1.1 Parsing` 已被判定不再有收益，报错归到 `4.1.2`。

### 1.2 三个硬约束（三家设计系统的交集）

1. **反馈强度分级**：轻提示 3s 自动消失 → 就地 inline 错误（失焦触发）→ 重要失败用对话框。**禁止用轻提示承载重要失败。**
2. **空状态必须回答"为什么空 + 下一步做什么"**，且**替换掉本该渲染的组件**（表格空状态连表头一起替换，否则屏幕阅读器会先读完整张表）。
3. **字号用 rem、尺寸与热区用 px、颜色只走 CSS 变量**。rem 是 Apple「文本可放大 200%」在 Web 的唯一等价实现。

---

## 2. 交互组件模式（APG）

每个模式的产品 URL 前缀 `https://www.w3.org/WAI/ARIA/apg/patterns/`。

### 2.1 本项目的组件 → 模式映射

| 现有组件 | 应采用模式 | 必需的键盘 / ARIA |
|---|---|---|
| `ConfirmDialog` | **alertdialog**（破坏性操作）/ dialog | `role=alertdialog` + `aria-modal=true` + `aria-labelledby` + **必需 `aria-describedby`**；打开移入焦点 → Tab 循环 → Esc 关闭 → **关闭后焦点归还触发元素** |
| `Select` | **combobox** 或 **listbox** | `aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected`；DOM 焦点留在 combobox；↑↓ / Enter / Esc；popup 不进 Tab 序列 |
| `ImageLightbox` | dialog | 同 dialog-modal |
| `FeedbackFab` 弹层 | dialog | 同上 |
| `NumberInput` | **spinbutton** | 方向键改值 + 可聚焦步进按钮 |
| `DevControlCenter` | disclosure | `role=button` + `aria-expanded`；Enter/Space 切换 |
| 复制按钮 / 提交结果 | **status** | `role=status`（隐式 `aria-live=polite`），**不得因状态更新抢焦点** |

### 2.2 模式要点速查

**dialog / alertdialog**

- 打开时焦点移入；长内容聚焦标题或静态元素并加 `tabindex="-1"`。
- `Tab` / `Shift+Tab` 在内部循环；`Escape` 关闭；关闭后**焦点归还调用元素**。
- `aria-modal=true` **仅在两条件同时成立时**使用：① 代码阻止与外部一切交互 ② 视觉上确实遮住外部。
- 强烈建议 Tab 序列中含一个可见的关闭控件。

**combobox**

- `Tab` 进入（popup 与指示按钮不进 Tab 序列）；`Down` 进 popup；`Escape` 关闭；`Enter` 接受建议。
- **不得拦截浏览器文本框编辑键**（中文 IME 场景尤其重要）。
- `aria-autocomplete` = `none` / `list` / `both`。

**listbox**

- `>5` 项必须支持 `Home`/`End`；`>7` 项建议 type-ahead。
- 每项 `aria-selected` 或 `aria-checked` **二选一**，全站一致（约定：单选用 selected，多选用 checked）。
- 虚拟列表用 `aria-setsize` / `aria-posinset`。

**tabs**（`RepoDetail` 已在用）

- `role=tablist` / `tab` / `tabpanel`；tab 需 `aria-controls`、panel 需 `aria-labelledby`。
- 横向用 `←/→`，**不得监听上下键**；`Tab` 进入时落在激活 tab，再按一次离开 tablist。
- 内容无延迟时推荐**自动激活**。

**alert / status**

- `role=alert` 无键盘交互，**不得影响焦点**，**不要设计成自动消失**。
- 非紧急提示用 `role=status`。
- 紧急且需用户响应的改用 alertdialog。

**tooltip**

- `role=tooltip` + 触发器 `aria-describedby`；仅 `Escape` 可关闭。
- **APG 自述该模式尚无任务组共识** → 不要承载关键信息。

---

## 3. 组件基座选型

### 3.1 结论

**主骨架用 shadcn/ui（`-b radix`），输入类组件用 React Aria Components 补位。**

9 个现有组件里有 4 个正好落在这套方案的强项上，且都是"无障碍最容易写错"的那类：

| 现有 | 迁移到 |
|---|---|
| `Select` | Radix `Select`（键盘、typeahead、Portal、滚动按钮全套） |
| `ConfirmDialog` | Radix `AlertDialog`（焦点默认落在 Cancel、Esc／点外关闭、inert 遮罩） |
| `ImageLightbox` / `FeedbackFab` 弹层 | Radix `Dialog` / `Popover` |
| `NumberInput` | **React Aria `NumberField`**（唯一内置 zh-CN 与 CJK/IME 处理） |
| `DiffView` / `Mascot` / `BackBar` / `DevControlCenter` | **保留自研**（没有任何库能覆盖，硬套只会更重） |

### 3.2 为什么是 shadcn/ui + radix base

- shadcn/ui 是**代码分发**而非依赖：源码落到仓库，之后完全归项目所有，改样式/行为不需要包裹覆盖。
- 官方定位原文："This is not a component library. It is how you build your component library."
- **radix 而非默认 base**：2026-07 起 Base UI 成为 CLI 默认，但官方明确 "Radix is not being deprecated… We still run it in production today and we're not migrating"。Radix 的 30 个原语 API 已冻稳多年，对小团队"换 base"是纯重写成本。
- MIT License，2026-09 仍活跃。

### 3.3 使用方式

```bash
# 前置：Tailwind 必须先升到 v4（见 STACK.md §2.1）
npx shadcn@latest init -b radix
npx shadcn@latest add alert-dialog select dialog popover
npx shadcn@latest view dialog              # 先看源码再决定
npx shadcn@latest add dialog --dry-run --diff   # 落地前对 diff
```

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild><Button variant="outline">删除</Button></DialogTrigger>
  <DialogContent className="sm:max-w-sm">
    <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
    <DialogFooter><DialogClose asChild><Button>取消</Button></DialogClose></DialogFooter>
  </DialogContent>
</Dialog>
```

**引入新组件的固定顺序**：`view` 看源码 → `add --dry-run --diff` → 落地 → 删掉不用的 variant，不保留死代码。

### 3.4 主题令牌

shadcn 用语义 token 命名（surface / foreground 成对），**换主题只改三处**：

| 令牌 | 本项目取值 |
|---|---|
| `--primary` | 校徽蓝（现有 `--brand-500`） |
| `--ring` | 焦点环色（与 primary 同族） |
| `--radius` | 圆角基数（见 §4.3） |

`popover` / `border` / `input` / `muted` 等一律用语义名，**禁止在组件里写 `blue-600` 这类字面色**。

半径由基数派生：`sm=0.6×` · `md=0.8×` · `lg=1×` · `xl=1.4×` · `2xl=1.8×`（默认 `--radius: 0.625rem`）。

**警告**：`components.json` 的 `style` / `baseColor` / `cssVariables` **初始化后不可更改**（要换只能删掉重装组件）。

### 3.5 不采用的方案

| 方案 | 不采用的理由 |
|---|---|
| **Headless UI 做主力** | 组件面不够（无 Slider / NumberInput / DatePicker / Toast / Accordion）；发布节奏最慢（2.2.10 停在 2026-04）；`ui-*` 变体体系会与 `data-[state]` 形成第二套约定 |
| **纯 Radix 不上 shadcn** | 无障碍底座相同，但失去 CLI / 源码分发带来的"加组件 = 一次 review" |
| **Ark UI 做主力** | 组件面更宽但生态体量小；源码式分发对 Vite 构建链路多一层不确定性。**可作备选**，将来需要大批复杂组件时再评估 |
| **React Aria Components 做全站主力** | 能力最强但样式工作全归项目，对 9 个组件的现状是过度投入；只在输入类局部采用 |

### 3.6 落地验收口径

- 任何交互组件必须**能仅用键盘完成主流程**（Tab 进入、Enter/Space 触发、Esc 关闭、方向键导航），且**关闭后焦点回到触发元素**。
- 弹层必须有 `Title`（可视觉隐藏但要可访问）；破坏性操作走 `AlertDialog` 语义而非普通 Dialog。
- 组件状态只用 `data-*` 属性表达；样式只用语义 token。
- 新增 token 必须同时提供 `:root` 与（若将来支持）`.dark` 两套值。

---

## 4. 视觉规范

### 4.1 间距

**主刻度取 8 的倍数：8 / 16 / 24 / 32 / 48；微调允许 4 与 12；不使用 20。**

| 场景 | 值 |
|---|---|
| 卡片内边距 | 16（紧凑）/ 24（常规） |
| 区块间距 | 24 / 32 |
| 表单项垂直间距 | 16 |
| label 与控件之间 | 4 – 8 |
| 控件内部水平 padding | 12（小号 8） |

依据：AntD 用 4/8 体系，Carbon 用 2/4/8，本项目已用 Tailwind（0.25rem = 4px 基准），上述值全部能直接映射既有类名。20 会破坏 8 的视觉节奏。

### 4.2 字号与字重

| 用途 | 字号 / 行高 |
|---|---|
| 正文 | **14 / 22** |
| 次要信息 | 12 / 20 |
| 小标题 | 16 / 24 |
| 标题 H3 / H4 | 24 / 32 · 20 / 28 |
| 标题 H1 / H2 | 38 / 46 · 30 / 38 |

- **全站字阶控制在 3–5 种。**
- **字重只用 400 与 500**（强调场景 600）。
- 数字统一 `font-variant-numeric: tabular-nums`。
- 正文与背景对比度目标 **7:1（AAA）**，最低不得低于 4.5:1。

依据：AntD 的 14/22 是按中文屏显校准的（50cm 阅读距离）。M3 的 body-large 16/24 与 Apple 的 17pt 面向拉丁字母，中文单字信息密度更高，14px 同屏信息量更合适。

**行高公式**：`字号 + 8`（AntD 体系）。纯英文/数字段落可用 1.5 倍。

### 4.3 圆角

| 用途 | 值 |
|---|---|
| 卡片 / 弹层 | 8 |
| 输入框 / 按钮 | 6 |
| 标签 / 小徽章 | 4 |
| 头像 | full |

采用 AntD base 6 体系（= Tailwind `rounded-md` / `rounded-lg`）。M3 的 12/16/28 在高密度后台偏大；仅官网/论坛的松弛场景可升到 12。

### 4.4 控件尺寸与触控目标

| 场景 | 值 |
|---|---|
| 桌面控件高度 | **32**（紧凑处 24） |
| 移动 / 平板控件 | **≥44** |
| 纯图标按钮热区 | **≥44×44**（用不可见 padding 扩展，视觉尺寸不变） |
| 绝对下限 | **24×24**（WCAG 2.5.8，不足时 24px 直径圆不得相交） |

桌面指针场景 AntD 的 32 足够且节省纵向空间；触控端按 Apple（44pt）与 M3（48dp）的下限。热区扩展采用 M3 `minimumInteractiveComponentSize` 思路，零视觉代价。

### 4.5 动效

| 场景 | 时长 |
|---|---|
| hover / focus | 100ms |
| 出现 / 消失 | 200ms |
| 抽屉 / 模态 | 300ms |

缓动**全站只留一条**，二选一：

- M3 emphasized：`cubic-bezier(.2, 0, 0, 1)`
- AntD easeOut：`cubic-bezier(.215, .61, .355, 1)`

管理后台超过 400ms 明显拖沓。必须尊重 `prefers-reduced-motion`。

### 4.6 状态层与加载

**交互态统一用状态层不透明度叠加**（M3 体系），无需为校徽蓝另算一套 hover/active 色：

| 状态 | 不透明度 |
|---|---|
| hover | 0.08 |
| focus / pressed | 0.12 |
| dragged | 0.16 |

**加载态**：表格/列表用 **skeleton**（Carbon 明确"表格加载用 skeleton 不用 spinner"）；操作超过 **2s** 必须给 loading 或进度；长任务提供取消。

### 4.7 颜色

- 语义色：`primary` / `success` / `warning` / `error` / `info`——**用角色名而非颜色名**。
- 中性色分三级：一级文本、二级文本、禁用与占位。
- **颜色一律走 CSS 变量**，禁止硬编码 hex（`CONVENTIONS.md` §1 已强制）。
- 唯一浅色主题（校徽蓝白），不提供深色模式。

---

## 5. 中文排版

依据 W3C **clreq**（中文排版需求）与 GB/T 15834—2011。

| 项 | 规则 |
|---|---|
| **行高** | clreq：行距取字号的 50%–100%。即 `行高 = 字号 × 1.5–2.0`。WCAG 1.4.12 要求能承受用户改到 ≥1.5× |
| **段首缩排** | 中文出版品以 **2em** 为标准。**界面文本建议 0 缩排 + 段间距**；长文正文用 2em。两种体例不要混用 |
| **标点** | 行内标点占 1em；可做宽度挤压，原则是「先挤进，后推出」 |
| **换行禁则** | clreq 四级：`none` / **`basic`（推荐）** / `GB` / `strict`。CSS 对应 `line-break: strict`（收紧时） |
| **避免孤字** | clreq 明确「孤字不成行、孤行不成页」。Web 实现：正文用 `text-wrap: pretty`；标题用 `text-wrap: balance`（**仅作用于有限行数**：Chromium ≤6 行） |
| **中西混排** | 横排中西文单词不得断为两行；`word-break: break-all` 会破坏此约定，中文正文用默认 `normal` |
| **数字** | `tabular-nums` 保证纵向对齐 |

> **本项目已有实例**：官网首屏大标题「把想法写成代码。」在 ≥1280px 时折成三行并出现孤字「码。」（见 `REFACTOR.md` §8 #2）。这正是 `text-wrap: balance` 或调整字号上限要解决的问题。

---

## 6. 状态与反馈模式

### 6.1 表单

| 规则 | 依据 |
|---|---|
| label **一律顶对齐**，1–3 个词，不加冒号 | Carbon（唯一默认布局） |
| required / optional **只标注少数派**（多数必填时只标 optional） | Carbon |
| placeholder 只放格式示例，**绝不放关键信息** | Carbon |
| 提示文案：短的放输入框下方，长的用 ⓘ + tooltip | AntD |
| **校验在失焦时触发，错误就近 inline 展示**，文案必须具体 | Carbon + AntD 一致 |
| 错误必须**文本化**并指出字段，不能只靠红框 | WCAG 3.3.1 |
| 单选：2–5 个用 RadioGroup，**>5 个用下拉** | AntD |
| 开关切换**即生效**，不配提交按钮 | AntD |
| 文件上传必须写明大小与格式（如"不超过 5M，支持 PDF/ZIP"）并给进度 | AntD |
| 向导/对话框按钮**右对齐**（主按钮在右）；页内表单主按钮左对齐 | Carbon |
| 按钮文案用**具体动作**（"创建仓库"）而非"提交" | Carbon |
| 同流程不重复要求输入 | WCAG 3.3.7 |

**表单页布局梯度**（AntD）：基础单列 → 弱分组 → 任务拆解（分步）→ 特定场景。

### 6.2 空状态

- 三要素：**图形元素 + 明确原因 + 建议操作**（AntD）。
- **必须替换掉本该渲染的组件**——表格空状态连表头表尾一起替换（Carbon）。
- 元素**左对齐成块**；空间不足就用纯文字。
- 一屏出现多个空状态时改用 tertiary 按钮；**一次只给一个主行动点**。
- 文案用**正向表述**（"从添加第一条数据开始"优于"你还没有数据"）。

### 6.3 加载与错误

| 场景 | 做法 |
|---|---|
| 表格 / 列表加载 | skeleton |
| 操作 >2s | loading 或进度指示器；长任务提供取消 |
| 轻提示 | 3s 自动消失 |
| 重要失败 | **必须用对话框**，禁止轻提示 |
| 网络错误 | 就地展示 + 重试入口，不整页白屏 |

### 6.4 表格

- 单元格为空显示 `-`。
- 时间、状态、操作列**不换行**。
- **表头行高必须与数据行一致**（Carbon）。
- 行 hover 态常开（即使行不可点击）。
- 行内动作 ≤5 个，更多收进 overflow。
- 分页固定在表格底部。

---

## 7. 落地检查清单

改动 UI 前对照；PR review 时按此逐项核。

**无障碍**

- [ ] 文本对比度 ≥4.5:1，大字号 ≥3:1，UI 边框图标 ≥3:1
- [ ] 键盘可完成主流程；焦点指示可见（2px + 3:1）
- [ ] 弹层：焦点移入 → 循环 → Esc 关闭 → 焦点归还
- [ ] 图标按钮有可访问名称，热区 ≥24×24（推荐 44×44）
- [ ] 表单错误文本化、指出字段、给出建议
- [ ] 状态消息用 `role=status`，不抢焦点
- [ ] 320 CSS px 宽无横向滚动
- [ ] 固定高度容器改为 `min-height`

**中文排版**

- [ ] 正文 14/22，行高 = 字号 + 8
- [ ] 标题用 `text-wrap: balance`，长正文用 `text-wrap: pretty`
- [ ] 无孤字、无中西文错误断行
- [ ] 数字用 `tabular-nums`

**视觉一致性**

- [ ] 间距取 8 的倍数（8/16/24/32/48），无 20
- [ ] 圆角：卡片 8 / 控件 6 / 标签 4
- [ ] 颜色走 CSS 变量，无硬编码 hex
- [ ] 交互态用状态层不透明度（hover .08 / pressed .12）
- [ ] 动效时长 100/200/300ms，缓动全站统一

**组件约定**

- [ ] 未新增原生 `<select>` 与 `window.confirm()`
- [ ] 新组件走 shadcn `view` → `add --dry-run --diff` 流程
- [ ] 破坏性操作用 `AlertDialog` 语义
- [ ] 组件状态用 `data-*` 属性

---

## 8. 官方文档来源

**标准**

- WCAG 2.2（REC）：https://www.w3.org/TR/WCAG22/
- WCAG 2.2 快速参考：https://www.w3.org/WAI/WCAG22/quickref/
- Understanding（各条款）：https://www.w3.org/WAI/WCAG22/Understanding/
- WAI-ARIA APG：https://www.w3.org/WAI/ARIA/apg/patterns/
- WAI-ARIA 规范：https://w3c.github.io/aria/
- clreq 中文排版需求：https://www.w3.org/TR/clreq/
- CSS Text L3 / L4：https://www.w3.org/TR/css-text-3/ · https://www.w3.org/TR/css-text-4/
- WAI 表单教程：https://www.w3.org/WAI/tutorials/forms/validation/

**设计系统**

- Ant Design 规范：https://ant.design/docs/spec/values-cn · [布局](https://ant.design/docs/spec/layout-cn) · [字体](https://ant.design/docs/spec/font-cn) · [数据录入](https://ant.design/docs/spec/data-entry-cn) · [反馈](https://ant.design/docs/spec/feedback-cn) · [空状态](https://ant.design/docs/spec/research-empty-cn)
- Material Design 3：https://m3.material.io/styles/typography/type-scale-tokens · [状态层](https://m3.material.io/foundations/interaction/states/overview) · [官方 token 源码](https://github.com/material-components/material-web/tree/main/tokens/versions/v0_192)
- Apple HIG：[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
- IBM Carbon：[间距](https://carbondesignsystem.com/elements/spacing/overview/) · [表单](https://carbondesignsystem.com/patterns/forms-pattern/) · [空状态](https://carbondesignsystem.com/patterns/empty-states-pattern/) · [数据表格](https://carbondesignsystem.com/components/data-table/usage/)

**组件库**

- shadcn/ui：[文档](https://ui.shadcn.com/docs) · [主题](https://ui.shadcn.com/docs/theming) · [CLI](https://ui.shadcn.com/docs/cli)
- Radix Primitives：[总览](https://www.radix-ui.com/primitives/docs/overview/introduction) · [无障碍](https://www.radix-ui.com/primitives/docs/overview/accessibility) · [样式](https://www.radix-ui.com/primitives/docs/guides/styling)
- React Aria：[质量与 i18n](https://react-aria.adobe.com/quality) · [样式](https://react-aria.adobe.com/styling)

---

## 9. 待决事项

| 项 | 说明 |
|---|---|
| Tailwind v4 先决 | shadcn/ui 当前文档与 CLI 默认 Tailwind v4；Tailwind 3.4 走 legacy 文档。**必须先升 Tailwind**（见 STACK.md §2.1），否则只能手动 copy 组件 |
| 焦点环取色 | 需与校徽蓝同时满足 3:1 且不与 primary 混淆，待实测确定 |
| 触控目标与桌面密度 | 论坛列表与后台表格是 2.5.8 的高发区，改造时要逐个核 24px 圆是否相交 |
| `prefers-reduced-motion` | 现有 `index.css` 已有 `@media (prefers-reduced-motion: reduce)` 分支，重构后要确认新动效全部纳入 |
