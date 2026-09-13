# 主题定制

> 可覆盖的四个层级：从全局 token 到单个组件

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/theming) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/theming.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/theming.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.4.0`，syncStatus=`reviewed`，verified=`false`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

## 定制模型

Tuffex 的组件不会写死任何颜色，所有视觉都读取 CSS 自定义属性——换主题因此是改样式表，而不是改组件。这些属性分成四层，由宽到窄；解决问题时挑能覆盖到的**最窄**那一层。

| 层级 | 定义位置 | 影响范围 |
|------|----------|----------|
| 全局 token | `base.css` 里的 `:root` | 全部 |
| 主题选择器 | `[data-theme='dark']`、`[data-tx-contrast='high']` | 整个模式 |
| BUI token | `--tx-bui-*` | AI 套件 |
| 组件变量 | `--tx-<component>-*` | 单个组件，或某个子树 |

token 清单本身——字号体系与完整色阶——见《[Design Foundations 设计基础](./foundations.md)》。本页讲的是如何覆盖它。

## 全局 token

在引入 `base.css` 之后重新定义任意 token 即可。组件在绘制时才解析变量，所以在树上任意祖先节点覆盖，对其下所有内容生效。

```css
@import '@talex-touch/tuffex/base.css';

:root {
  --tx-color-primary: #7c5cff;
  --tx-border-radius-base: 8px;
  --tx-transition-duration: 0.24s;
}
```

换品牌色通常只需要改 `--tx-color-primary`：派生 token（`--tx-color-primary-soft`、`--tx-coloring-border-color`、`--tx-focus-ring-shadow`）都是基于它的 `color-mix()` 表达式，会自动跟随。

## 深色模式

深色是选择器而非媒体查询——什么时候生效由应用决定。在任意祖先节点上设置 `data-theme="dark"` **或** `dark` class：

```html
<html data-theme="dark">
<!-- 或 -->
<html class="dark">
```

两种写法等价，这也是 Tuffex 能同时落进 Tailwind 应用（`.dark`）和 `data-theme` 应用而不需要适配层的原因。既然是普通选择器，把它限定在某个子树上，就能在浅色页面里开一块深色区域。

## 高对比度

Tuffex 还带了第四套调色板，在浅色与深色下都提高文本与边框对比度。它有三种触发方式：

| 触发条件 | 效果 |
|----------|------|
| `html[data-tx-contrast='high']` 或 `html.contrast` | 显式开启高对比度 |
| `@media (prefers-contrast: more)` | 自动开启 |
| `html[data-tx-contrast='normal']` | **退出**上面的媒体查询 |

这组搭配的关键在于：系统偏好默认被尊重，而 `data-tx-contrast="normal"` 是应用想覆盖系统设置时的出口。`data-theme="dark"` 与任一高对比度触发条件同时存在时，选中的是「深色高对比度」这一套，而不是两套主题叠加。

## AI 套件 token

AI 套件自带一层 `--tx-bui-*`：surface、inset、field、ink，以及 accent / green / orange / red 四组配套色与 tint——它随 Beautiful UI 组件一起移植过来，用来保住那套密度与发丝线体系。它在同样的 `[data-theme='dark']` / `.dark` 选择器下有自己的深色块，所以一次深色切换会同时带动两层。当 AI 界面不该继承你的品牌色时，单独改它：

```css
:root {
  --tx-bui-accent: #7c5cff;
  --tx-bui-accent-tint: #f0ecff;
}
```

## 组件变量

约三百个 `--tx-<component>-*` 属性让你在不动全局调色板的前提下重塑单个组件。命名是可预期的——`--tx-collapse-header-bg`、`--tx-avatar-ring-color`、`--tx-progress-height`——并且每一个都带兜底值，所以一个都不设也永远是合法的。

它们是可继承的自定义属性，因此设在外层容器上就只作用于那棵子树：

```vue
<template>
  <section class="settings-panel">
    <TxCollapse v-model="open">
      <TxCollapseItem title="外观" name="appearance">…</TxCollapseItem>
    </TxCollapse>
  </section>
</template>

<style scoped>
.settings-panel {
  --tx-collapse-radius: 6px;
  --tx-collapse-header-bg: transparent;
  --tx-collapse-border: rgba(148, 163, 184, 0.24);
}
</style>
```

每个组件页都列出了自己读取的变量。优先用它们，不要用后代选择器去改组件内部：自定义属性才是对外承诺的接口，class 名不是。

## 注意

- 组件已经暴露填充变量时，改 token 而不是写 `background-color`。有些填充是 `background-image` 渐变，`background-color` 只会画在渐变背后。
- `base.css` 只引一次。引两份时以后加载的那份为准，而那通常不是你改的那份。

## 源码

- token 与主题选择器：`packages/tuffex/packages/components/style/variables.scss`。
- AI 套件 token：`packages/tuffex/packages/components/style/bui-tokens.scss`。
- 运行时入口：`@talex-touch/tuffex/base.css`。

## 离线完整示例源码

此页没有引用独立 Demo；正文中的代码块保持原样。

## 离线类型与实现参考

- [style/bui-tokens.scss](../snapshot/packages/tuffex/packages/components/style/bui-tokens.scss.txt)
- [style/index.scss](../snapshot/packages/tuffex/packages/components/style/index.scss.txt)
- [style/mixins.scss](../snapshot/packages/tuffex/packages/components/style/mixins.scss.txt)
- [style/variables.scss](../snapshot/packages/tuffex/packages/components/style/variables.scss.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
