/**
 * Hand-written seed content for the mock forum: the Tuff / talex-touch
 * developer community (launcher, plugins, Tuffex, Electron, AI features).
 *
 * `seed.ts` turns these declarations into entities; everything that needs a
 * "random" choice (timestamps, reply authors, likes) happens there, through
 * the seeded PRNG. This file is pure data.
 *
 * Category icons must be real Carbon names — checked against
 * `@iconify-json/carbon/icons.json` (`i-carbon-bug` does not exist).
 */

import type { UserTitle } from './titles'
import type { UserRole } from './types'

export interface UserSeed {
  username: string
  displayName: string
  bio: string
  location: string
  website: string
  role: UserRole
  /** 极客班 title shown beside the name; `role` is unchanged by it. */
  title?: UserTitle
  /** Days before `now` the account was created. */
  joinedDaysAgo: number
}

export interface CategorySeed {
  slug: string
  name: string
  description: string
  color: string
  icon: string
}

export interface TagSeed {
  slug: string
  name: string
  color: string
}

export interface TopicSeed {
  title: string
  category: string
  tags: string[]
  author: string
  /** Markdown body of the first post. */
  body: string
  pinned?: boolean
  closed?: boolean
  /** Approximate age in days; unset lets the PRNG pick one, skewed toward recent. */
  ageDays?: number
  /** Exact reply count; unset lets the PRNG pick one. */
  replies?: number
}

/** Eight avatar colours, assigned round-robin; also the presets on the preferences page. */
export const AVATAR_PALETTE = [
  '#e5484d',
  '#f76b15',
  '#f5a524',
  '#30a46c',
  '#0ea5e9',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
] as const

export const USER_SEEDS: UserSeed[] = [
  {
    username: 'talex',
    displayName: 'TalexDreamSoul',
    bio: 'Tuff 作者，维护 CoreBox、插件系统和 Tuffex 组件库。',
    location: '杭州',
    website: 'https://github.com/talex-touch',
    role: 'admin',
    title: { id: 'captain' },
    joinedDaysAgo: 730,
  },
  {
    username: 'mika',
    displayName: 'Mika',
    bio: '社区版主，负责整理求助帖、维护教程分区。',
    location: '上海',
    website: '',
    role: 'moderator',
    title: { id: 'head', department: 'community' },
    joinedDaysAgo: 640,
  },
  {
    username: 'ryan',
    displayName: 'Ryan',
    bio: '全栈开发者，Electron 重度使用者，喜欢读主进程源码。',
    location: '深圳',
    website: 'https://github.com/ryan-k',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 520,
  },
  {
    username: 'xiaoyu',
    displayName: '小鱼',
    bio: '前端切图仔，折腾主题和快捷键。',
    location: '成都',
    website: '',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 460,
  },
  {
    username: 'leon',
    displayName: 'Leon',
    bio: 'Vue 与 Nuxt 用户，业余写点插件。',
    location: '北京',
    website: 'https://github.com/leon-dev',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 410,
  },
  {
    username: 'ayako',
    displayName: '彩子',
    bio: '设计师，关注组件的视觉细节与深色模式。',
    location: '东京',
    website: 'https://dribbble.com/ayako',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 380,
  },
  {
    username: 'chen',
    displayName: '陈一',
    bio: 'Rust / Node 混合开发，剪贴板与 OCR 相关问题常驻。',
    location: '武汉',
    website: '',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 340,
  },
  {
    username: 'nova',
    displayName: 'Nova',
    bio: 'AI 工具链爱好者，本地模型玩家。',
    location: '广州',
    website: 'https://github.com/nova-ml',
    role: 'member',
    title: { id: 'member' },
    joinedDaysAgo: 300,
  },
  {
    username: 'kai',
    displayName: 'Kai',
    bio: 'Windows 平台测试志愿者，高 DPI 受害者。',
    location: '西安',
    website: '',
    role: 'member',
    title: { id: 'member', department: 'tech' },
    joinedDaysAgo: 270,
  },
  {
    username: 'lin',
    displayName: '林间',
    bio: '写文档的人，教程分区常客。',
    location: '南京',
    website: 'https://github.com/lin-docs',
    role: 'member',
    title: { id: 'alumni' },
    joinedDaysAgo: 230,
  },
  {
    username: 'yuki',
    displayName: 'Yuki',
    bio: 'Linux 桌面用户，Arch + Hyprland。',
    location: '',
    website: '',
    role: 'member',
    title: { id: 'head', department: 'tech' },
    joinedDaysAgo: 200,
  },
  {
    username: 'bruce',
    displayName: 'Bruce',
    bio: '从 Raycast 迁移过来的新用户。',
    location: '香港',
    website: '',
    role: 'member',
    joinedDaysAgo: 40,
  },
]

export const CATEGORY_SEEDS: CategorySeed[] = [
  { slug: 'announcements', name: '公告', description: '官方发布、版本更新与社区规则。', color: '#e5484d', icon: 'i-carbon-notification' },
  { slug: 'help', name: '求助', description: '使用中遇到问题？把复现步骤和环境信息贴在这里。', color: '#3e63dd', icon: 'i-carbon-help' },
  { slug: 'ideas', name: '想法', description: '功能建议与产品方向讨论。', color: '#f5a524', icon: 'i-carbon-idea' },
  { slug: 'plugins', name: '插件', description: '插件分享、开发心得与需求征集。', color: '#8e4ec6', icon: 'i-carbon-plug' },
  { slug: 'dev', name: '开发', description: 'Tuff、Tuffex 与 SDK 的源码和架构讨论。', color: '#0ea5e9', icon: 'i-carbon-code' },
  { slug: 'lounge', name: '闲聊', description: '工作流、效率工具与日常。', color: '#30a46c', icon: 'i-carbon-chat' },
  { slug: 'bugs', name: '缺陷反馈', description: '带上版本号、平台和日志片段。', color: '#d6409f', icon: 'i-carbon-debug' },
  { slug: 'tutorials', name: '教程', description: '使用技巧与循序渐进的教程。', color: '#12a594', icon: 'i-carbon-document' },
]

export const TAG_SEEDS: TagSeed[] = [
  { slug: 'vue', name: 'vue', color: '#42b883' },
  { slug: 'nuxt', name: 'nuxt', color: '#00dc82' },
  { slug: 'electron', name: 'electron', color: '#47848f' },
  { slug: 'tuffex', name: 'tuffex', color: '#8e4ec6' },
  { slug: 'corebox', name: 'corebox', color: '#3e63dd' },
  { slug: 'plugin-sdk', name: 'plugin-sdk', color: '#f76b15' },
  { slug: 'ai', name: 'ai', color: '#d6409f' },
  { slug: 'ocr', name: 'ocr', color: '#12a594' },
  { slug: 'clipboard', name: 'clipboard', color: '#0ea5e9' },
  { slug: 'macos', name: 'macos', color: '#6e6e6e' },
  { slug: 'windows', name: 'windows', color: '#0078d4' },
  { slug: 'linux', name: 'linux', color: '#f5a524' },
  { slug: 'performance', name: 'performance', color: '#e5484d' },
  { slug: 'design', name: 'design', color: '#ec4899' },
  { slug: 'release', name: 'release', color: '#30a46c' },
  { slug: 'question', name: 'question', color: '#8b8b8b' },
]

export const TOPIC_SEEDS: TopicSeed[] = [
  // ---------------------------------------------------------------- 公告
  {
    title: '欢迎来到 Tuff Forum：社区指南与发帖规范',
    category: 'announcements',
    tags: [],
    author: 'talex',
    pinned: true,
    ageDays: 360,
    replies: 14,
    body: `## 欢迎

这里是 Tuff 的开发者社区。无论你是刚装上 Tuff 的新用户，还是想写插件、读源码的开发者，都可以在这里找到同伴。

## 分区怎么用

- **公告**：版本发布、维护通知，只有管理团队能发帖。
- **求助**：使用问题。发帖前先搜一下，很多问题已经有答案了。
- **想法**：功能建议，请描述你的使用场景，而不只是"我想要 X"。
- **插件**：分享你写的插件，或者发布需求。
- **开发**：源码、架构和 SDK 的讨论。
- **缺陷反馈**：请附上版本号、平台和复现步骤。

## 几条约定

1. 一个话题只讨论一件事。
2. 标题写清楚问题本身，避免"求助！！！"这样的标题。
3. 代码请用代码块，日志请贴关键片段而不是整个文件。
4. 对人友善，对事认真。

> 好的提问是解决问题的一半。

有任何关于论坛本身的建议，回复本帖即可。`,
  },
  {
    title: 'Tuff 2.5 发布：全新 CoreBox 推荐区、原生 OCR 与插件权限系统',
    category: 'announcements',
    tags: ['release', 'corebox', 'ocr'],
    author: 'talex',
    pinned: true,
    ageDays: 12,
    replies: 9,
    body: `Tuff 2.5 今天正式发布。这是自 2.0 以来改动最大的一个版本。

## 亮点

### CoreBox 推荐区
空查询时 CoreBox 不再是一片空白，而是根据使用频率和时间段推荐应用、文件和插件功能。推荐逻辑完全在本地计算，不上传任何数据。

### 原生 OCR
macOS 使用 Apple Vision，Windows 使用系统自带的 Windows OCR，都通过 \`@talex-touch/tuff-native\` 调用。没有原生能力的平台会回退到 AI 提供方。

### 插件权限系统
插件现在需要在 \`manifest.json\` 中声明权限，首次使用时会弹出授权。剪贴板、文件系统、网络和 Shell 都被纳入了权限范围。

## 破坏性变更

- \`sdkapi\` 最低版本提升到 \`260713\`。
- 旧的 \`plugin:clipboard:read\` 通道被移除，请改用权限 SDK。

## 下载

前往 [GitHub Releases](https://github.com/talex-touch/talex-touch/releases) 获取安装包。已安装的用户会收到自动更新提示。

欢迎在本帖下方反馈升级过程中遇到的问题。`,
  },
  {
    title: 'Tuffex 0.5.0 已发布到 npm：152 个组件子路径、完整类型',
    category: 'announcements',
    tags: ['tuffex', 'release'],
    author: 'talex',
    ageDays: 4,
    body: `\`@talex-touch/tuffex@0.5.0\` 已经发布。

## 这个版本做了什么

- 每个组件都有独立的子路径导出，例如 \`@talex-touch/tuffex/button\`。
- 212 个 \`.vue.d.ts\` 随包发布，子路径导入是完整类型化的。
- \`base.css\` 只含 token（35 KB），\`style.css\` 含全部组件样式（648 KB）。

## 安装

~~~bash
pnpm add @talex-touch/tuffex@0.5.0
~~~

## 已知问题

README 里提到的 \`./vite\` 按需样式插件**没有**随这个版本发布，请先直接引入 \`style.css\`。下个补丁版本会补上。`,
  },
  {
    title: '社区版主招募：欢迎加入 Tuff Forum 管理团队',
    category: 'announcements',
    tags: [],
    author: 'mika',
    closed: true,
    ageDays: 150,
    body: `随着社区人数增长，我们需要更多版主来帮忙整理分区。

## 你需要做的

- 把发错分区的帖子移动到正确的位置。
- 合并重复的求助帖。
- 给优质教程加精。

## 要求

- 注册超过三个月，有一定的发帖记录。
- 每周能抽出两三个小时。

有意者请私信我。名额招满后本帖关闭。`,
  },
  {
    title: '论坛维护通知：本周六凌晨 2:00–4:00 停机升级',
    category: 'announcements',
    tags: [],
    author: 'mika',
    closed: true,
    ageDays: 90,
    replies: 1,
    body: `本周六凌晨 2:00 到 4:00（北京时间）论坛将停机升级数据库。

期间无法访问，已发布的内容不会丢失。升级完成后本帖会更新。

**更新**：升级已完成，如遇到异常请在求助分区发帖。`,
  },

  // ---------------------------------------------------------------- 求助
  {
    title: 'CoreBox 快捷键 Cmd+E 在全屏应用里无法唤起',
    category: 'help',
    tags: ['macos', 'corebox', 'question'],
    author: 'bruce',
    body: `刚从 Raycast 迁移过来，普通桌面下 \`Cmd+E\` 一切正常，但在全屏的 VS Code 或浏览器里按快捷键没有任何反应。

## 环境

- macOS 15.2
- Tuff 2.5.0
- 已经在系统设置的「隐私与安全性」下的「辅助功能」里授权

## 试过的

- 换成 \`Option+Space\` 也一样
- 重启过应用

是我少做了什么设置吗？`,
  },
  {
    title: '插件开发模式 dev.enable 打开后热重载不生效',
    category: 'help',
    tags: ['plugin-sdk', 'question'],
    author: 'ryan',
    body: `按文档把 \`manifest.json\` 里的 \`dev\` 配成了：

~~~json
{
  "dev": {
    "enable": true,
    "address": "http://localhost:3333/",
    "source": "/Users/ryan/code/my-plugin"
  }
}
~~~

改 \`index.js\` 之后 Tuff 没有重新加载插件，必须手动禁用再启用。

日志里能看到 \`FileSystemWatcher\` 初始化了，但没有 change 事件。是不是 \`source\` 路径要指向 \`dist\` 目录？`,
  },
  {
    title: 'Windows 上 Mica 效果没有出现，窗口是纯黑背景',
    category: 'help',
    tags: ['windows', 'question'],
    author: 'kai',
    body: `Windows 11 23H2，Tuff 2.5.0。主窗口背景是纯黑色，没有 Mica 的半透明效果。

- 系统「透明效果」已打开
- 显卡驱动是最新的
- 同一台机器上 Windows Terminal 的 Mica 是正常的

设置里有开关吗？我翻了一遍没找到。`,
  },
  {
    title: '剪贴板图片如何传给插件？query.inputs 一直是空数组',
    category: 'help',
    tags: ['clipboard', 'plugin-sdk'],
    author: 'chen',
    body: `我想做一个图片压缩插件。复制一张图片后打开 CoreBox 触发功能，\`onFeatureTriggered\` 里拿到的 \`query.inputs\` 是 \`[]\`。

~~~ts
onFeatureTriggered(featureId, query) {
  console.log(query.inputs) // []
}
~~~

文本是能正常收到的。剪贴板权限也授权了。我是不是漏了什么声明？`,
  },
  {
    title: 'OCR 识别中文竖排文字准确率很低，有什么参数可调？',
    category: 'help',
    tags: ['ocr', 'ai'],
    author: 'nova',
    body: `用 OCR 功能识别古籍扫描件，横排的识别效果很好，竖排几乎全错。

macOS 上走的应该是 Apple Vision。查了一下 Vision 本身是支持竖排的，Tuff 有没有暴露 \`recognitionLanguages\` 或者方向相关的参数？

如果没有，切到 AI 提供方回退是不是效果更好？`,
  },
  {
    title: 'Nuxt 项目里引入 @talex-touch/tuffex 后图标不显示',
    category: 'help',
    tags: ['nuxt', 'tuffex'],
    author: 'leon',
    body: `在一个 Nuxt 4 项目里装了 \`@talex-touch/tuffex@0.5.0\`，组件能渲染，但分页的箭头、空状态的图标都是空白的。

检查了 DOM，元素是 \`<i class="i-carbon-chevron-right">\`，但没有任何样式命中。

我用的是 UnoCSS，\`presetIcons\` 也开了，页面里自己写的 \`i-carbon-add\` 是正常的。为什么组件内部的图标不行？`,
  },
  {
    title: 'Linux (Wayland) 下全局快捷键失效',
    category: 'help',
    tags: ['linux', 'corebox'],
    author: 'yuki',
    body: `Arch + Hyprland，Tuff 2.5.0 AppImage。

X11 会话下 \`Ctrl+E\` 正常，切到 Wayland 后无论怎么按都没反应。托盘图标点击「打开 CoreBox」是可以的。

我知道这是 Wayland 的安全模型限制，但有没有官方推荐的 workaround？比如用 compositor 的快捷键调一个 CLI？`,
  },
  {
    title: '如何让搜索结果优先显示某个文件夹下的文件？',
    category: 'help',
    tags: ['corebox', 'question'],
    author: 'lin',
    body: `我的文档都在 \`~/Documents/notes\` 下面，但搜索的时候经常被 \`node_modules\` 里同名文件抢占前排。

有没有办法：

1. 给某个目录加权？
2. 或者干脆把 \`node_modules\` 排除掉？

翻了设置里的「索引」页面，只看到了扫描范围，没有权重相关的选项。`,
  },

  // ---------------------------------------------------------------- 想法
  {
    title: '建议：CoreBox 支持自定义结果分组顺序',
    category: 'ideas',
    tags: ['corebox', 'design'],
    author: 'bruce',
    body: `现在 CoreBox 的结果分组顺序是固定的：先是应用，然后是文件，最后是插件功能。

我的使用习惯是插件功能远多于打开应用，希望能：

- 在设置里拖拽调整分组顺序
- 或者至少提供「插件优先」的预设

Raycast 有类似的功能，迁移过来之后这是最不习惯的一点。`,
  },
  {
    title: '想法：给 TxDataTable 加上列拖拽排序',
    category: 'ideas',
    tags: ['tuffex', 'design'],
    author: 'ayako',
    body: `\`TxDataTable\` 目前支持 \`sortable\` 和 \`stickyHeader\`，但列顺序只能由 \`columns\` 决定。

建议增加：

- \`reorderable\` 属性，允许用户拖拽列头
- \`column-reorder\` 事件，返回新的列顺序

设计上可以参考 Notion 的表格视图，拖拽时列头有一个轻微的抬起效果。`,
  },
  {
    title: '能否把 AI 回答的流式输出做成可中断的？',
    category: 'ideas',
    tags: ['ai'],
    author: 'nova',
    body: `用 AI 功能问一个问题，回答开始流式输出之后，如果发现问错了，目前只能等它输出完。

希望：

1. 输出过程中按 \`Esc\` 可以立即停止
2. 停止后已经输出的部分保留，可以继续追问

底层用的是 \`chatStream\`，应该是能拿到 \`AbortSignal\` 的？`,
  },
  {
    title: '希望插件市场支持按平台筛选',
    category: 'ideas',
    tags: ['plugin-sdk', 'windows'],
    author: 'kai',
    body: `插件市场里有不少插件只支持 macOS（比如依赖 AppleScript 的那些），但列表里看不出来，装了才发现用不了。

建议：

- manifest 增加 \`platforms\` 字段
- 市场页面默认只显示当前平台可用的插件
- 不可用的插件显示灰色标记而不是隐藏`,
  },
  {
    title: '提议引入「工作区」概念：按项目切换插件集',
    category: 'ideas',
    tags: ['corebox'],
    author: 'chen',
    body: `我同时维护几个项目，每个项目需要的插件不一样：

- 前端项目：颜色转换、JSON 格式化
- 后端项目：数据库查询、日志检索
- 写作：翻译、词典

如果能定义「工作区」，切换工作区时自动启用/禁用对应的插件集，CoreBox 的结果会干净很多。

> 甚至可以根据当前前台应用自动切换。

不知道这个和现有的 \`touch-workspace-scripts\` 插件有没有重合。`,
  },
  {
    title: '深色模式下的语义色能不能再亮一点',
    category: 'ideas',
    tags: ['design', 'tuffex'],
    author: 'ayako',
    body: `深色模式下 \`TxStatusBadge\` 的 success / warning / danger 三种颜色偏暗，叠在 \`#141414\` 背景上看起来像橄榄色、赭色和栗色。

对比了一下 Tailwind 的 400 档：

| 语义 | 当前 | 建议 |
|---|---|---|
| success | #22c55e | #4ade80 |
| warning | #f59e0b | #fbbf24 |
| danger | #ef4444 | #f87171 |

如果只是改 token 的话应该不会影响浅色模式。`,
  },

  // ---------------------------------------------------------------- 插件
  {
    title: '[分享] touch-translation：划词翻译插件，支持 DeepL 与本地模型',
    category: 'plugins',
    tags: ['plugin-sdk', 'ai'],
    author: 'talex',
    body: `官方翻译插件 \`touch-translation\` 更新到 1.2。

## 功能

- 选中文字后按快捷键直接翻译
- 支持 DeepL、OpenAI 兼容接口和本地 Ollama
- 结果面板用 Tuffex 的 \`TxMarkdownView\` 渲染，代码块不会被翻译

## 安装

在插件市场搜索 \`translation\`，或者手动下载 \`.tpex\` 拖进设置页。

## 配置

~~~json
{
  "provider": "deepl",
  "targetLang": "zh"
}
~~~

API Key 存在插件的 secret 存储里，不会出现在普通配置文件中。`,
  },
  {
    title: '[分享] 我写了一个 Todoist 快速添加插件',
    category: 'plugins',
    tags: ['plugin-sdk'],
    author: 'leon',
    body: `周末写的小插件：在 CoreBox 里输入 \`todo 买牛奶 明天\` 就能往 Todoist 加一条任务。

## 实现

- 用 \`pushItems()\` 实时显示解析结果（任务名、日期、项目）
- 回车后通过网络权限调 Todoist API
- Token 用 \`plugin:storage:set-secret\` 存

## 已知问题

- 中文日期解析还很粗糙，只认「今天 / 明天 / 后天」
- 没做离线队列

源码在 [GitHub](https://github.com/leon-dev/touch-todoist)，欢迎 PR。`,
  },
  {
    title: '[求插件] 一键把剪贴板 JSON 格式化并复制',
    category: 'plugins',
    tags: ['clipboard'],
    author: 'xiaoyu',
    body: `经常从接口文档复制一大坨压缩的 JSON，想要：

1. 复制 JSON
2. 打开 CoreBox 输入 \`json\`
3. 回车，剪贴板里就是格式化好的版本

有没有现成的？如果没有我就自己写一个，不过对 \`acceptedInputTypes\` 那块还不太熟。`,
  },
  {
    title: '插件 manifest 里 acceptedInputTypes 的坑：不声明就收不到图片',
    category: 'plugins',
    tags: ['plugin-sdk', 'clipboard'],
    author: 'chen',
    body: `接着我之前的求助帖，问题解决了，记录一下。

## 原因

feature 没有声明 \`acceptedInputTypes\`，搜索引擎默认只把纯文本 query 传给插件，图片会被过滤掉。

## 修复

~~~json
{
  "id": "compress-image",
  "name": "压缩图片",
  "acceptedInputTypes": ["image", "files"],
  "commands": [{ "type": "over", "value": ["compress", "压缩"] }]
}
~~~

声明之后 \`query.inputs\` 里就有 \`{ type: 'image', content: 'data:image/png;base64,...' }\` 了。

文档里其实写了，但放在很靠后的位置，建议提到前面。`,
  },
  {
    title: '[分享] 用 pushItems 做一个实时汇率查询',
    category: 'plugins',
    tags: ['plugin-sdk'],
    author: 'nova',
    body: `输入 \`100 usd\` 就能看到人民币、欧元、日元的换算结果，每个结果一行。

核心就几行：

~~~ts
onSearch(query) {
  const [amount, from] = parse(query.text)
  pushItems(TARGETS.map(to => ({
    title: format(convert(amount, from, to)),
    subtitle: to,
  })))
}
~~~

汇率每小时拉一次，缓存在插件存储里。断网就用缓存。`,
  },
  {
    title: '插件存储 100MB 限制够用吗？大家怎么处理缓存',
    category: 'plugins',
    tags: ['plugin-sdk', 'performance'],
    author: 'ryan',
    body: `我的插件会缓存一些索引数据，接近 100MB 上限了。

想问问：

- 这个限制是硬限制还是可以在设置里调？
- 有没有 LRU 之类的官方工具，还是得自己实现？
- 超限之后写入是抛错还是静默失败？`,
  },
  {
    title: '[分享] Obsidian 笔记快速搜索插件 v0.3',
    category: 'plugins',
    tags: ['plugin-sdk'],
    author: 'lin',
    body: `v0.3 更新：

- 支持多个 vault
- 搜索结果显示笔记的前两行
- 回车用 \`obsidian://\` 协议打开

## 索引策略

第一次启动会全量扫描 \`.md\` 文件，之后靠 \`FileSystemWatcher\` 增量更新。一万篇笔记的 vault 全量扫描大约 3 秒。

下一步想加上标签搜索。`,
  },

  // ---------------------------------------------------------------- 开发
  {
    title: '读源码：ModuleManager 的加载顺序为什么是数组而不是依赖图',
    category: 'dev',
    tags: ['electron'],
    author: 'chen',
    body: `看 \`src/main/index.ts\`，模块加载顺序是两个数组 \`foregroundModulesToLoad\` 和 \`deferredModulesToLoad\`，顺序约束靠注释维护。

为什么不用依赖声明让 ModuleManager 自己拓扑排序？

我能想到的理由：

1. 39 个模块，顺序错误只在启动时复现，数组比图更容易一眼看出来
2. 依赖图会引入循环依赖检测的复杂度

但注释里的「permissionModule 必须在 pluginModule 之前」这种约束，靠人维护总归有风险。`,
  },
  {
    title: 'Channel 系统的 capability token 设计讨论',
    category: 'dev',
    tags: ['electron', 'plugin-sdk'],
    author: 'talex',
    body: `插件通道现在用每次激活随机生成的 16 字节 token 寻址，而不是插件名。写一下设计考虑，欢迎讨论。

## 为什么不用插件名

插件名是公开的，任何渲染进程都能猜到。用 token 之后，只有拿到 token 的 WebContents 才能往这个插件发消息。

## token 的生命周期

- 插件激活时生成
- 禁用、崩溃、激活失败时撤销
- 重新激活时轮换

## 没有加密

token 是 bearer capability，安全性来自不可猜测和及时撤销，不是加密。IPC 本身在进程内，不需要额外加密。

> 如果你觉得哪里有漏洞，直接回帖。`,
  },
  {
    title: 'Drizzle + LibSQL 在主进程里的单写者模型',
    category: 'dev',
    tags: ['electron', 'performance'],
    author: 'ryan',
    body: `之前 \`database.db\` 有两个写入者（主进程 + 索引 worker），偶发 \`SQLITE_BUSY\` 和文件损坏。

现在改成单写者：

- 所有写入经过 \`SearchIndexService\`
- worker 只读
- \`busy_timeout\` 主进程短、worker 长

想请教一下 libsql 本地 binding 是同步的这件事，是不是意味着一次长事务会卡住整个事件循环？有没有考虑过把写入放到单独的 worker？`,
  },
  {
    title: 'Tuffex 组件里用 style 对象绑定 CSS 变量的踩坑记录',
    category: 'dev',
    tags: ['tuffex', 'vue'],
    author: 'ayako',
    body: `记一个折腾了一下午的问题。

## 现象

\`TxPopover\` 的面板不管怎么设 \`maxHeight\` 都是 420px，溢出触发器。

## 原因

模板把 \`--tx-ba-max-height\` 放进了 style 对象绑定（\`unlimited ? 'none' : undefined\`），同时 floating-ui 的 \`size\` 中间件用 \`setProperty\` 写同一个变量。

Vue 对 \`undefined\` 的处理是 \`setProperty(name, '')\`，也就是**删除**。每次重渲染都会把中间件写的值抹掉。

## 结论

一个 CSS 变量只能有一个写入者。来自布局计算的值由命令式代码独占，模板不要绑同名变量。`,
  },
  {
    title: '为什么 TxCol 的断点是在挂载时读 window.innerWidth',
    category: 'dev',
    tags: ['tuffex', 'vue', 'nuxt'],
    author: 'leon',
    body: `\`TxCol\` 的 \`xs/sm/md/lg/xl\` 是在 \`onMounted\` 里读 \`window.innerWidth\` 算出来的，不是纯 CSS 媒体查询。

好处是 span 可以是任意数字，不用生成一堆 class。

坏处是 SSR 首屏拿不到宽度，会先按 \`span\` 渲染再跳一下。

在 Nuxt 里我是直接 \`ssr: false\` 绕过的，但如果一定要 SSR，有什么推荐做法？\`useSSRWidth\` 能用上吗？`,
  },
  {
    title: 'SearchEngineCore 的 provider 并发与取消',
    category: 'dev',
    tags: ['corebox', 'performance'],
    author: 'talex',
    body: `写一下搜索引擎的并发模型，给想写 provider 的人参考。

## 每次查询

1. 生成一个 \`AbortSignal\`
2. 所有 provider 的 \`onSearch(query, signal)\` 并发启动
3. 任何 provider 返回就立即 \`search.update\` 推给渲染进程
4. 新的输入到来时 abort 上一次

## provider 要做的

- 检查 \`signal.aborted\`，被取消后不要再 \`pushItems\`
- 慢的 provider 不会阻塞快的
- 结果在 \`Gather\` 阶段再过一次文件过滤策略

~~~ts
async onSearch(query, signal) {
  const hits = await index.search(query.text)
  if (signal.aborted) return []
  return hits.map(toItem)
}
~~~`,
  },
  {
    title: 'SSR 模式下使用 TxMarkdownView 的注意事项',
    category: 'dev',
    tags: ['nuxt', 'tuffex'],
    author: 'lin',
    body: `\`TxMarkdownView\` 和 \`TxMarkdownEditor\` 在模块顶层读了 \`window\`，SSR 时需要注意。

## 实测

Nexus 站点是从源码 SSR 的，靠 \`hasWindow()\` 守卫没问题。但从 npm dist 引入时，\`theme: 'auto'\` 用 MutationObserver 监听 \`html.class\`，服务端没有这个对象。

## 建议

- 需要 SSR 的页面用 \`<ClientOnly>\` 包起来
- 或者显式传 \`theme="light"\` / \`"dark"\`，不要用 \`auto\``,
  },

  // ---------------------------------------------------------------- 闲聊
  {
    title: '你们的 CoreBox 第一屏都放了什么？',
    category: 'lounge',
    tags: ['corebox'],
    author: 'xiaoyu',
    body: `2.5 的推荐区出来之后，我的第一屏基本固定了：

- VS Code
- 剪贴板历史
- 翻译
- 颜色转换
- 今天的日程

好奇大家的第一屏长什么样，晒一下？`,
  },
  {
    title: '从 Raycast 迁移过来一周的感受',
    category: 'lounge',
    tags: ['macos'],
    author: 'bruce',
    body: `用了一周，说说感受。

## 喜欢的

- 开源，插件能看到源码
- 剪贴板历史比 Raycast 的好用，图片预览很快
- 跨平台，公司的 Windows 机器也能用同一套习惯

## 不习惯的

- 全屏应用下快捷键的问题（已经发了求助帖）
- 插件数量还是少
- 结果分组顺序不能调

总体是会留下来的。`,
  },
  {
    title: '程序员的键盘推荐（顺便晒一下桌面）',
    category: 'lounge',
    tags: [],
    author: 'kai',
    body: `最近换了 HHKB，适应了两周，现在回不去了。

配合 Tuff 的话，我把 CoreBox 快捷键改到了 \`Fn+Space\`，右手拇指顺手就能按到。

你们用什么键盘？`,
  },
  {
    title: 'Tuff 的名字是怎么来的？',
    category: 'lounge',
    tags: [],
    author: 'yuki',
    body: `一直好奇这个名字。是 "tough" 的谐音吗？还是 "touch" 的变体？

仓库名是 \`talex-touch\`，但产品叫 Tuff，中间是不是有过改名？`,
  },
  {
    title: '周末 hackathon：24 小时做一个插件',
    category: 'lounge',
    tags: ['plugin-sdk'],
    author: 'mika',
    body: `社区第一次线上 hackathon。

## 规则

- 周六 10:00 开始，周日 10:00 截止
- 主题：**效率**，任何和日常工作流相关的插件都行
- 提交方式：在本帖下回复仓库链接 + 一段演示

## 奖励

- 前三名的插件会进入官方插件市场首页推荐
- 所有参与者获得论坛「Hacker」徽章

报名直接回帖。`,
  },

  // ---------------------------------------------------------------- 缺陷反馈
  {
    title: 'CoreBox 打开后偶发白屏 1 秒，日志里有 SQLITE_BUSY',
    category: 'bugs',
    tags: ['performance', 'corebox'],
    author: 'ryan',
    body: `## 环境

- Tuff 2.5.0
- macOS 14.6，M2

## 现象

按快捷键唤起 CoreBox，大约每十次有一次白屏约 1 秒才出现输入框。

## 日志

~~~
[SearchIndex] write failed: SQLITE_BUSY (attempt 3/5)
[SearchIndex] write failed: SQLITE_BUSY (attempt 4/5)
[CoreBox] show took 1042ms
~~~

看起来是索引写入和 CoreBox 展示抢数据库。全量索引跑完之后就不再出现。`,
  },
  {
    title: 'TxPagination 在 total=0 时仍显示第 1 页',
    category: 'bugs',
    tags: ['tuffex'],
    author: 'ayako',
    body: `\`<TxPagination :total="0" :page-size="20" show-info />\`

期望：显示「0 条」或者干脆不渲染页码。

实际：显示「1 / 1」，上一页和下一页都是禁用状态但页码按钮 1 是高亮的。

Tuffex 0.5.0。`,
  },
  {
    title: 'Windows 上托盘图标模糊（高 DPI）',
    category: 'bugs',
    tags: ['windows'],
    author: 'kai',
    body: `Windows 11，缩放 150%。托盘图标明显是 16px 的图被拉伸了。

对比 VS Code 的托盘图标是清晰的。

建议提供 \`tray@2x.png\` 或者直接用 \`.ico\` 多尺寸文件。`,
  },
  {
    title: '剪贴板历史里出现重复条目',
    category: 'bugs',
    tags: ['clipboard'],
    author: 'chen',
    closed: true,
    body: `复制同一段文字两次，历史里会有两条一模一样的记录。

Tuff 2.4.3。

**更新**：2.5.0 已修复，关闭本帖。`,
  },
  {
    title: 'TxDrawer direction=bottom 在移动端键盘弹出时被遮挡',
    category: 'bugs',
    tags: ['tuffex'],
    author: 'leon',
    body: `iOS Safari，\`TxDrawer direction="bottom" :mobile-adapt="true"\`，抽屉里有一个输入框。

点击输入框后软键盘弹出，抽屉的底部按钮被键盘挡住，抽屉本身没有跟着上移。

\`mobileAdapt\` 是不是应该监听 \`visualViewport\` 的 resize？`,
  },

  // ---------------------------------------------------------------- 教程
  {
    title: '从零写一个 Tuff 插件（上）：manifest 与 Prelude',
    category: 'tutorials',
    tags: ['plugin-sdk'],
    author: 'mika',
    body: `这是一个两篇的系列，目标是写一个「查天气」插件。

## 三层结构

| 层 | 文件 | 作用 |
|---|---|---|
| Manifest | \`manifest.json\` | 元数据、功能声明、权限 |
| Prelude | \`index.js\` | 轻量入口，注册能力 |
| Surface | \`attachUIView\` | 重 UI |

## 第一步：manifest

~~~json
{
  "id": "com.example.weather",
  "name": "weather",
  "version": "0.1.0",
  "sdkapi": 260713,
  "features": [
    {
      "id": "query",
      "name": "查天气",
      "commands": [{ "type": "over", "value": ["weather", "天气"] }]
    }
  ]
}
~~~

## 第二步：Prelude

~~~js
module.exports = {
  onFeatureTriggered(featureId, query) {
    pushItems([{ title: '杭州 26°C 多云' }])
  },
}
~~~

下篇讲 Surface。`,
  },
  {
    title: '从零写一个 Tuff 插件（下）：Surface 与 attachUIView',
    category: 'tutorials',
    tags: ['plugin-sdk'],
    author: 'mika',
    body: `接上篇。这一篇给天气插件加一个带图表的详情面板。

## Surface 是什么

Surface 是插件的重 UI 层，跑在独立的 WebContents 里，按需加载。Prelude 保持轻量，只有用户真的打开面板时才创建 Surface。

## attachUIView

~~~js
onFeatureTriggered(featureId, query) {
  attachUIView({
    path: '/weather',
    width: 480,
    height: 320,
  })
}
~~~

## 在 Surface 里用 Tuffex

Surface 就是一个普通的 Vue 应用，可以直接：

~~~ts
import { TxCard } from '@talex-touch/tuffex/card'
import '@talex-touch/tuffex/base.css'
import '@talex-touch/tuffex/card/style.css'
~~~

按子路径引样式，不要引整个 \`style.css\`。`,
  },
  {
    title: '在 Nuxt 4 中接入 Tuffex：图标 safelist 与深色模式',
    category: 'tutorials',
    tags: ['nuxt', 'tuffex'],
    author: 'lin',
    body: `整理一下在 Nuxt 4 里用 \`@talex-touch/tuffex@0.5.0\` 的几个关键点。

## 1. 样式

~~~ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['@unocss/reset/tailwind-compat.css', '@talex-touch/tuffex/style.css'],
})
~~~

## 2. 组件内部图标

Tuffex 把图标渲染成 \`<i class="i-carbon-...">\`，但 UnoCSS 不扫描 \`node_modules\`。需要把这些类名放进 \`safelist\`，可以在 \`uno.config.ts\` 加载时扫描 dist 自动生成。

## 3. 深色模式

\`@nuxtjs/color-mode\` 设 \`classSuffix: ''\`，得到 \`html.dark\`，正好匹配 Tuffex 的选择器。

## 4. electron peer

\`@talex-touch/utils\` 声明了 \`electron\` peer，记得关掉 \`autoInstallPeers\`。`,
  },
  {
    title: '用 Tuffex 组合出一个设置页：TxGroupBlock 全家桶',
    category: 'tutorials',
    tags: ['tuffex', 'design'],
    author: 'ayako',
    body: `设置页是最常见的表单形态，Tuffex 的 \`TxGroupBlock\` 系列几乎能覆盖全部需求。

## 结构

~~~vue
<TxGroupBlock name="通知" description="控制什么时候提醒你">
  <TxBlockSwitch v-model="prefs.reply" title="有人回复" />
  <TxBlockSwitch v-model="prefs.like" title="有人点赞" />
  <TxBlockSelect v-model="prefs.theme" title="主题">
    <TxSelectItem value="light" label="浅色" />
    <TxSelectItem value="dark" label="深色" />
  </TxBlockSelect>
</TxGroupBlock>
~~~

## 加载态

首屏用 \`TxRowSkeleton\` 配合 \`useDeferredLoading\`，数据在 150ms 内到达就不显示骨架，避免闪一下。

## 保存

底部一个 \`TxButton variant="primary"\`，保存后 \`toast({ variant: 'success' })\`。`,
  },
  {
    title: 'CoreBox 搜索技巧十则',
    category: 'tutorials',
    tags: ['corebox'],
    author: 'talex',
    body: `一些不太显眼但很好用的技巧。

1. 输入拼音首字母也能匹配中文应用名，比如输入 \`wx\` 能找到微信。
2. 空格后加 \`>\` 进入插件的二级搜索。
3. 复制一张图片再打开 CoreBox，会直接推荐支持图片的功能。
4. \`Cmd+数字\` 直接执行第 N 个结果。
5. 结果上按 \`Tab\` 展开更多操作。
6. 搜索文件时输入扩展名 \`.pdf\` 可以过滤类型。
7. 长按 \`Cmd+E\` 会把 CoreBox 固定在屏幕上。
8. 输入 \`=\` 开头是计算器。
9. 输入 URL 直接用默认浏览器打开。
10. 设置里可以给常用功能设置别名。

还有什么技巧欢迎补充。`,
  },
]

/**
 * Reply pool. `{mention}` becomes `@username` of the person being answered
 * (the replied-to post's author, or the topic author), `{quote}` a blockquote
 * excerpt of their post. Both always resolve: every reply has a target.
 * A few snippets mention a fixed user so mention notifications exist that are
 * not also reply notifications.
 */
export const REPLY_SNIPPETS: string[] = [
  '感谢分享，正是我需要的。',
  '同样的问题 +1，蹲一个官方回复。',
  '这个已经在 nightly 里修了，等下个版本发布就好。',
  '试了一下可以，谢谢！',
  '我这边复现不了，能贴一下完整的日志吗？',
  '{mention} 说得对，我补充一点：这个行为在 2.4 里就有了，不是 2.5 新引入的。',
  '{quote}\n\n这一点我持保留意见。实际用下来影响没有那么大。',
  '标记一下，回头细看。',
  '很棒的整理，建议加精。',
  '{mention} 你的环境里有没有开「减少动画」？我之前遇到过类似的。',
  '按照楼上的方法解决了，记录一下：清掉 `~/.tuff/cache` 再重启。',
  '{quote}\n\n同意。而且这样做还能顺便解决多显示器下的位置问题。',
  '文档里其实有写，只是位置比较隐蔽：[插件开发指南](https://github.com/talex-touch/talex-touch/tree/master/docs)。',
  '我用的是 Windows，表现和你描述的一致。',
  '这个需求我也有，希望能进 roadmap。',
  '{mention} 已经合并到 master 了，感谢贡献。',
  '补充一个数据点：M1 上耗时大约 300ms，M2 大约 180ms。',
  '能不能开个 PR？我可以帮忙 review。',
  '{quote}\n\n这个思路很好，但要注意权限系统会拦截未声明的网络请求。',
  '先谢谢，晚上回家试试。',
  '{mention} 顺便问一下，Linux 上有测试过吗？',
  '好文，收藏了。',
  '这个和 #issue 里讨论的是同一个问题吧？',
  '我这里是 Arch，AppImage 版本，一切正常。',
  '{quote}\n\n补充：如果用的是 pnpm，需要额外关掉 `autoInstallPeers`。',
  '我写了一个小脚本自动处理这个，需要的话可以贴出来。',
  '{mention} 感谢回复，问题解决了。原因是我 manifest 里少了一个逗号，JSON 解析失败后整个插件都没加载。',
  '同求。',
  '这个方案的问题在于内存占用，索引一大就不行了。',
  '设计稿看起来不错，深色模式下的对比度也够。',
  '{quote}\n\n我实测下来是相反的，可能和机器有关。',
  '官方文档的这一节需要更新了，还是 2.3 的截图。',
  '{mention} 建议把复现步骤单独开一个缺陷反馈帖，方便追踪。',
  '这个功能太实用了，能不能做成内置的？',
  '看了源码，问题出在 `ModuleManager` 的加载顺序上，`permissionModule` 必须在前面。',
  '我这边 macOS 15 正常，14 不正常，怀疑是系统 API 的差异。',
  '{quote}\n\n没错，而且这也是为什么 CoreBox 用的是 `NSPanel` 而不是普通窗口。',
  '插件市场什么时候能支持一键更新？每次都要手动下载。',
  '已经用上了，比之前的方案快很多。',
  '{mention} 可以试试把 `busy_timeout` 调大一点，我这边从 100ms 改到 2000ms 之后就不报错了。',
  '有没有考虑过用 Web Worker 做这件事？主线程不会被卡住。',
  '期待下一篇！',
  '楼主的截图里那个字体是什么？',
  '{quote}\n\n这里有个坑：`TxBreadcrumb` 传了 `href` 会渲染 `<a>` 整页跳转，SPA 里要用 `@click`。',
  '这个话题可以关了吧，问题已经解决。',
  '给楼主点赞，这是我见过最清楚的解释。',
  '@mika 这篇能不能加精？放到教程分区首页会很有用。',
  '@talex 这个是设计如此还是 bug？如果是 bug 我去开一个缺陷反馈。',
]
