# Utils 工具函数

> TuffEx 通过根入口与 ./utils 子路径导出的公开工具函数

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/utils) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/utils.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/utils.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`false`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Utils 工具函数

```ts
import { nextZIndex, toast, hasWindow } from '@talex-touch/tuffex/utils'
```

## API

### z-index 管理

统一分配浮层层级，避免各组件各写各的 `z-index` 造成层叠错乱。

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `nextZIndex()` | `() => number` | 新建浮层时取下一个递增层级 |
| `getZIndex()` | `() => number` | 只读当前最高层级，不递增 |
| `refreshZIndex(seed?, reason?)` | `(seed?: number, reason?: string) => number` | 需要以某个基准重新计数时 |
| `resetZIndex(seed?, reason?)` | `(seed?: number, reason?: string) => number` | 卸载 / 测试后重置到种子值 |
| `configureZIndex(options)` | `(options) => void` | 全局配置基准种子与覆盖值 |
| `onZIndexEvent(listener)` | `(listener) => () => void` | 订阅层级变化，返回取消订阅函数 |

### 环境守卫

SSR 安全地检测浏览器 API 是否可用，避免直接访问 `window` / `document` / `navigator` 报错。

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `hasWindow()` | `() => boolean` | 访问 `window` 前判断 |
| `hasDocument()` | `() => boolean` | 访问 `document` 前判断 |
| `hasNavigator()` | `() => boolean` | 访问 `navigator`（如振动、剪贴板）前判断 |

### 触感反馈 vibrate

封装 `navigator.vibrate`，提供语义化的震动模式。

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `vibrate` | `{ light() … error(), stop, isSupported }` | 直接触发预设震动，如 `vibrate.success()` |
| `useVibrate(type, options?)` | `(type: VibrateType, options?) => void` | 按语义触发一次自定义配置的震动 |
| `stopVibrate()` | `() => void` | 打断进行中的震动 |
| `isVibrateSupported()` | `() => boolean` | 能力检测 |

### 轻提示 toast

全局 toast 队列，无需在每个页面手动挂宿主（渲染仍需 `TxToastHost`）。

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `toast(options)` | `(options) => string` | 弹出提示，返回可用于关闭的 id |
| `dismissToast(id)` | `(id: string) => void` | 关闭指定提示 |
| `clearToasts()` | `() => void` | 清空所有提示 |

### 对话框编排 dialog-manager

按优先级排队、并带生命周期回调地串行管理全局对话框。

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `getDialogManager()` | `() => DialogManager` | 获取全局单例以排队 / 打开对话框 |

### 动画

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `useFlip(targetRef, opts?)` | `(ref, opts?) => UseFlipReturn` | 对元素做 FLIP 过渡（`TxFlipOverlay` 底层） |
| `useAutoResize(targetRef, opts?)` | `(ref, opts?) => UseAutoResizeReturn` | 尺寸自适应测量与过渡（`TxAutoSizer` 底层） |

### 安装辅助

| 导出 | 签名 | 何时用 |
|------|------|--------|
| `withInstall(component)` | `<T>(component: T) => T & { install }` | 给组件挂 `install`，支持 `app.use()` 全局注册 |

## Source

- 桶文件：`packages/tuffex/packages/components/src/utils/index.ts` 再导出 `packages/tuffex/packages/utils/*`。
- 子路径入口：`@talex-touch/tuffex/utils`；根入口 `@talex-touch/tuffex` 亦并入这些导出。

## 离线完整示例源码

此页没有引用独立 Demo；正文中的代码块保持原样。

## 离线类型与实现参考

- [utils/index.ts](../snapshot/packages/tuffex/packages/components/src/utils/index.ts.txt)
- [utils/anchor-delay.ts](../snapshot/packages/tuffex/packages/utils/anchor-delay.ts.txt)
- [animation/auto-resize.ts](../snapshot/packages/tuffex/packages/utils/animation/auto-resize.ts.txt)
- [animation/flip.ts](../snapshot/packages/tuffex/packages/utils/animation/flip.ts.txt)
- [animation/jelly.ts](../snapshot/packages/tuffex/packages/utils/animation/jelly.ts.txt)
- [utils/dialog-manager.ts](../snapshot/packages/tuffex/packages/utils/dialog-manager.ts.txt)
- [utils/env.ts](../snapshot/packages/tuffex/packages/utils/env.ts.txt)
- [utils/index.ts](../snapshot/packages/tuffex/packages/utils/index.ts.txt)
- [utils/toast.ts](../snapshot/packages/tuffex/packages/utils/toast.ts.txt)
- [utils/use-indicator-box.ts](../snapshot/packages/tuffex/packages/utils/use-indicator-box.ts.txt)
- [utils/vibrate.ts](../snapshot/packages/tuffex/packages/utils/vibrate.ts.txt)
- [utils/withInstall.ts](../snapshot/packages/tuffex/packages/utils/withInstall.ts.txt)
- [utils/z-index-manager.ts](../snapshot/packages/tuffex/packages/utils/z-index-manager.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
