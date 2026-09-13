# Icon 图标

> UnoCSS 图标体系与 TuffIcon 组件

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/icon) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/icon.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/icon.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Icon 图标

## 基础用法

### UnoCSS 图标类名

```vue
<template>
  <!-- Remix Icon -->
  <i class="i-ri-home-line" />
  <i class="i-ri-search-line" />
  <i class="i-ri-settings-3-line" />
  <!-- Carbon -->
  <i class="i-carbon-user" />
  <i class="i-carbon-folder" />

  <!-- Simple Icons (品牌) -->
  <i class="i-simple-icons-github" />
  <i class="i-simple-icons-visualstudiocode" />
</template>
```

### TuffIcon 组件

```vue
<template>
  <TuffIcon name="i-ri-home-line" />
  <TuffIcon name="chevron-down" />
  <TuffIcon :icon="{ type: 'emoji', value: '🚀' }" />
  <TuffIcon :icon="{ type: 'url', value: '/app.svg', colorful: true }" />
</template>
```

### TuffIcons 常量

`@talex-touch/utils` 提供预定义的图标常量，确保一致性：

```ts
import { TuffIcons, AppIcons } from '@talex-touch/utils'

// 通用 UI 图标
TuffIcons.Home // 'i-ri-home-line'
TuffIcons.Search // 'i-ri-search-line'
TuffIcons.Settings // 'i-ri-settings-3-line'

// 应用品牌图标
AppIcons.VSCode // 'i-simple-icons-visualstudiocode'
AppIcons.GitHub // 'i-simple-icons-github'
```

### 图标分类

#### 导航图标

| 名称 | 类名 | 预览 |
|------|------|------|
| Home | `i-ri-home-line` | <i class="i-ri-home-line" /> |
| Back | `i-ri-arrow-left-line` | <i class="i-ri-arrow-left-line" /> |
| Forward | `i-ri-arrow-right-line` | <i class="i-ri-arrow-right-line" /> |
| Menu | `i-ri-menu-line` | <i class="i-ri-menu-line" /> |

#### 操作图标

| 名称 | 类名 | 预览 |
|------|------|------|
| Search | `i-ri-search-line` | <i class="i-ri-search-line" /> |
| Add | `i-ri-add-line` | <i class="i-ri-add-line" /> |
| Delete | `i-ri-delete-bin-line` | <i class="i-ri-delete-bin-line" /> |
| Edit | `i-ri-edit-line` | <i class="i-ri-edit-line" /> |
| Copy | `i-ri-file-copy-line` | <i class="i-ri-file-copy-line" /> |
| Save | `i-ri-save-line` | <i class="i-ri-save-line" /> |
| Download | `i-ri-download-line` | <i class="i-ri-download-line" /> |
| Upload | `i-ri-upload-line` | <i class="i-ri-upload-line" /> |
| Refresh | `i-ri-refresh-line` | <i class="i-ri-refresh-line" /> |

#### 状态图标

| 名称 | 类名 | 预览 |
|------|------|------|
| Check | `i-ri-check-line` | <i class="i-ri-check-line" /> |
| Close | `i-ri-close-line` | <i class="i-ri-close-line" /> |
| Warning | `i-ri-error-warning-line` | <i class="i-ri-error-warning-line" /> |
| Info | `i-ri-information-line` | <i class="i-ri-information-line" /> |
| Error | `i-ri-close-circle-line` | <i class="i-ri-close-circle-line" /> |

#### 文件图标

| 名称 | 类名 | 预览 |
|------|------|------|
| File | `i-ri-file-line` | <i class="i-ri-file-line" /> |
| Folder | `i-ri-folder-line` | <i class="i-ri-folder-line" /> |
| FileCode | `i-ri-file-code-line` | <i class="i-ri-file-code-line" /> |
| FileImage | `i-ri-image-line` | <i class="i-ri-image-line" /> |

#### UI 元素图标

| 名称 | 类名 | 预览 |
|------|------|------|
| Settings | `i-ri-settings-3-line` | <i class="i-ri-settings-3-line" /> |
| User | `i-ri-user-line` | <i class="i-ri-user-line" /> |
| Star | `i-ri-star-line` | <i class="i-ri-star-line" /> |
| Heart | `i-ri-heart-line` | <i class="i-ri-heart-line" /> |
| Lock | `i-ri-lock-line` | <i class="i-ri-lock-line" /> |
| Eye | `i-ri-eye-line` | <i class="i-ri-eye-line" /> |

#### 品牌图标

| 名称 | 类名 | 预览 |
|------|------|------|
| GitHub | `i-simple-icons-github` | <i class="i-simple-icons-github" /> |
| VSCode | `i-simple-icons-visualstudiocode` | <i class="i-simple-icons-visualstudiocode" /> |
| Chrome | `i-simple-icons-googlechrome` | <i class="i-simple-icons-googlechrome" /> |
| Discord | `i-simple-icons-discord` | <i class="i-simple-icons-discord" /> |

### 自定义样式

```vue
<template>
  <!-- 尺寸 -->
  <i class="i-ri-home-line text-sm" />
  <i class="i-ri-home-line text-base" />
  <i class="i-ri-home-line text-xl" />
  <i class="i-ri-home-line text-2xl" />

  <!-- 颜色 -->
  <i class="i-ri-star-line text-yellow-500" />
  <i class="i-ri-heart-fill text-red-500" />
  <i class="i-ri-check-circle-fill text-green-500" />

  <!-- 动画 -->
  <i class="i-ri-loader-4-line animate-spin" />
</template>
```

### TxStatusIcon

用于在图标右下角叠加状态指示器（如插件运行状态/健康状态）。

#### TxStatusIcon
在角标上展示不同状态。
官方示例：`IconTxStatusIconDemo`（完整源码见本页末尾）

```vue
<template>
  <TxStatusIcon name="i-ri-translate-2" :size="22" tone="success" />
  <TxStatusIcon name="i-ri-translate-2" :size="22" tone="warning" />
  <TxStatusIcon name="i-ri-translate-2" :size="22" tone="error" />
  <TxStatusIcon name="i-ri-translate-2" :size="22" tone="info" />
  <TxStatusIcon name="i-ri-translate-2" :size="22" tone="loading" />
</template>
```

### TxOsIcon

用于平台标签的内联操作系统图标。

#### TxOsIcon
按 `platform` / `os` 字符串自动识别平台。
官方示例：`OsIconOsIconDemo`（完整源码见本页末尾）

```vue
<template>
  <TxOsIcon platform="darwin" os="macOS 15" />
  <TxOsIcon platform="win32" os="Windows 11" />
  <TxOsIcon platform="linux" os="Ubuntu 24.04" />
</template>
```

### 类型与来源
- `class`：使用图标类名（推荐）。
- `emoji`：用于轻量强调。
- `file` / `url`：本地或远程图标。
- `builtin`：内置常用图标。
- `colorful` 可在组件 prop 或 `icon.colorful` 中声明；SVG 默认使用 currentColor mask，`colorful=true` 时保留原色。

## API

### Props
```yaml
rows:
  - name: icon
    type: 'TxIconSource | null'
    default: '-'
    description: '结构化图标源（type/value）；与 name 二选一。'
  - name: name
    type: 'string'
    default: '-'
    description: '图标名称或类名'
  - name: size
    type: 'number'
    default: '-'
    description: '图标尺寸（px）；省略时不设置 font-size，继承父级字号。'
  - name: colorful
    type: 'boolean'
    default: 'false'
    description: '是否保留原色'
  - name: alt
    type: 'string'
    default: "''"
    description: '无障碍标题，映射到根节点 title 属性；同时作为兜底图片的 alt。'
  - name: empty
    type: 'string'
    default: "''"
    description: '当 icon/name 未解析出可见图标时的兜底图片 URL（empty 插槽默认内容）。'
  - name: urlResolver
    type: "(url: string, type: 'url' | 'file') => string"
    default: '-'
    description: '覆盖 URL/file 路径解析'
  - name: svgFetcher
    type: '(url: string) => Promise<string>'
    default: '-'
    description: '覆盖 SVG 内容获取逻辑'
```

### TxStatusIcon API（简版）
```yaml
rows:
  - name: colorful
    type: 'boolean'
    default: 'true'
    description: '保留 SVG 原色；默认 true，与 TxIcon 的 false 相反。'
  - name: size
    type: 'number'
    default: '18'
    description: '图标尺寸（px）；默认 18，而 TxIcon 默认继承父级字号。'
  - name: tone
    type: "'none' | 'loading' | 'warning' | 'success' | 'error' | 'info'"
    default: "'none'"
    description: '状态角标'
  - name: indicatorSize
    type: 'number'
    default: '自动'
    description: '角标尺寸'
  - name: indicatorOffset
    type: 'number'
    default: '0'
    description: '角标偏移'
```

### TxOsIcon API（简版）
```yaml
rows:
  - name: platform
    type: 'string'
    default: "''"
    description: '运行时或平台标识，例如 darwin、win32、linux。'
  - name: os
    type: 'string'
    default: "''"
    description: '可读 OS 字符串，也会参与识别。'
```

### Slots

| 名称 | 参数 | 说明 |
|------|------|------|
| `empty` | - | 当 `icon` 和 `name` 都没有解析出可见图标时，替换默认空占位内容。 |

### Events

`TuffIcon`、`TxIcon`、`TxStatusIcon` 和 `TxOsIcon` 不触发事件。

## 渲染契约

- `name` 以 `i-` 开头时按图标 class 渲染；命中内置名时按 `builtin` SVG 渲染。**未命中**的名称会静默回退为图标 class，若并不存在该 class 就什么都不显示——需要新图标时请加进 `builtinIcons`，不要假设某个名字能解析。
- 内置名称：`check`、`chevron-down`、`close`、`search`、`user`、`star`、`star-half`，以及 `TxAlert` 使用的状态图标 `info`、`check-circle`、`x-circle`、`alert-triangle`。状态图标画成圆环，中空部分由反向绘制的内圈弧在 nonzero 填充规则下挖出。
- `file` 与本地绝对 `url` 可通过注入的 `fileProtocol` 或 `urlResolver` 转换。
- SVG 在 `colorful=false` 时通过 mask 使用 `currentColor`；`colorful=true` 或 `icon.colorful=true` 时渲染为原图。
- `status='loading' | 'error'` 会优先展示加载或错误状态。
- `TxOsIcon` 将 `platform` 与 `os` 拼接转小写后识别 macOS / Windows / Linux，未识别值回退 macOS；SVG 为 `aria-hidden`，可访问名称由外层文本承载。

## 最佳实践

- 产品 UI 优先使用 UnoCSS 图标类（`i-*`），渲染成本低，并且天然继承 `currentColor`。
- 需要状态、颜色、URL/file 解析或保留 SVG 原色时，再使用 `TxIconSource`。
- 只有图标本身承载语义时才传有意义的 `alt`；装饰性图标应由周围文本提供语义。
- 单色 SVG 保持 `colorful=false`，让主题色通过 `currentColor` 生效；品牌标识和多色图使用 `colorful=true`。
- 插件文件或自定义 SVG 传输建议在应用外壳统一注入 `TX_ICON_CONFIG_KEY`，不要在每个图标上重复传 resolver。
- `TxOsIcon` 在表格或列表中应搭配可见平台文本；用 CSS 字号调整大小（组件固定 `1em`），回退行为只是视觉默认值，不要当作校验结果。

## 图标集

| 图标集 | 前缀 | 描述 |
|--------|------|------|
| Remix Icon | `i-ri-` | 通用 UI 图标，线条/填充风格 |
| Carbon | `i-carbon-` | IBM 设计系统图标 |
| Simple Icons | `i-simple-icons-` | 品牌/Logo 图标 |

## 图标搜索

访问 [Icônes](https://icones.js.org/) 在线浏览和搜索所有可用图标。

## API 参考

### classIcon / getIcon

```ts
import { classIcon, getIcon } from '@talex-touch/utils'

const icon = classIcon('i-ri-star-line')
// { type: 'class', value: 'i-ri-star-line' }

const searchIcon = getIcon('Search')
// { type: 'class', value: 'i-ri-search-line' }
```

## 审阅说明

- **可访问性说明：** 仅当设置了 `alt` 时，`TxIcon` 才渲染 `role="img"` 并把 `alt` 映射到 `title`；未设置 `alt` 时图标视为装饰性，会标记 `aria-hidden="true"` 从无障碍树中移除。纯图标交互控件应使用 `TxIconButton label` 或可见文本，不要只依赖图标 title 文案。
- **实测覆盖:** `icon.test.ts` 覆盖 class 与内置名称渲染、尺寸/颜色样式、emoji/empty/loading/error 状态、注入 file protocol 解析、SVG mask 模式、colorful SVG 回退、data SVG 处理、多色 SVG 检测与状态角标尺寸。
- **实测覆盖（TxOsIcon）:** `os-icon.test.ts` 覆盖 Windows 别名、Linux 发行版别名、macOS 别名/默认回退，以及装饰性 SVG 的无障碍与 class 形态。

## Source

- Component sources: `packages/tuffex/packages/components/src/icon/src/TxIcon.vue`、`TxStatusIcon.vue` 与 `TxOsIcon.vue`。
- Types/helpers: `types.ts` 导出 `TxIconSource`、状态/config 类型与 `TX_ICON_CONFIG_KEY`；`svg-color-mode.ts` 判断 SVG 是否可作为 currentColor mask 渲染。
- Export aliases: `packages/tuffex/packages/components/src/icon/index.ts` 导出 `TuffIcon`、`TxIcon`、`TxStatusIcon`、`TxOsIcon`、`TX_ICON_CONFIG_KEY`、图标类型与 `shouldRenderSvgAsMask`。
- Coverage: `packages/tuffex/packages/components/src/icon/__tests__/icon.test.ts` 覆盖图标来源解析、SVG 颜色模式、状态渲染、注入配置与状态角标；`os-icon.test.ts` 覆盖平台别名识别与 macOS 回退。

## 离线完整示例源码

- [IconTxStatusIconDemo](../snapshot/apps/nexus/app/components/content/demos/IconTxStatusIconDemo.vue.txt)
- [OsIconOsIconDemo](../snapshot/apps/nexus/app/components/content/demos/OsIconOsIconDemo.vue.txt)

## 离线类型与实现参考

- [icon/index.ts](../snapshot/packages/tuffex/packages/components/src/icon/index.ts.txt)
- [src/TxIcon.vue](../snapshot/packages/tuffex/packages/components/src/icon/src/TxIcon.vue.txt)
- [src/TxOsIcon.vue](../snapshot/packages/tuffex/packages/components/src/icon/src/TxOsIcon.vue.txt)
- [src/TxStatusIcon.vue](../snapshot/packages/tuffex/packages/components/src/icon/src/TxStatusIcon.vue.txt)
- [src/status-icon.ts](../snapshot/packages/tuffex/packages/components/src/icon/src/status-icon.ts.txt)
- [src/svg-color-mode.ts](../snapshot/packages/tuffex/packages/components/src/icon/src/svg-color-mode.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/icon/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
