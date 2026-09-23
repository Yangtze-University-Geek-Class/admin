import { fileURLToPath } from "node:url";
import { defineConfig, presetIcons } from "unocss";
import { tuffexIconClasses } from "./scripts/tuffex-icon-classes.mjs";
import { RUNTIME_ICON_CLASSES } from "./src/lib/icons";

const iconClassesScript = fileURLToPath(new URL("./scripts/tuffex-icon-classes.mjs", import.meta.url));
const runtimeIcons = fileURLToPath(new URL("./src/lib/icons.ts", import.meta.url));

/**
 * 控制台只用 UnoCSS 的图标预设（`i-carbon-*`），不引入工具类样式体系：
 * 版式写在组件的 scoped CSS 里，视觉令牌只来自 Tuffex 的 --tx-*。
 */
export default defineConfig({
  // 图标是 <i>，默认 inline 时宽高不生效；统一按行内块显示并与文字基线对齐。
  presets: [presetIcons({ scale: 1.2, extraProperties: { display: "inline-block", "vertical-align": "-0.2em", "flex-shrink": "0" } })],

  // Tuffex 在 node_modules 里渲染 `<i class="i-carbon-…">`；称号与部门图标是接口下发的数据。
  // 这两类类名扫描不到，必须显式列出。
  safelist: [...new Set([...tuffexIconClasses(), ...RUNTIME_ICON_CLASSES])],

  content: {
    pipeline: {
      include: [
        /\.(vue|html)($|\?)/,
        // 导航、状态元数据里的图标类名写在 .ts 模块中。
        /src\/.*\.ts($|\?)/,
      ],
    },
  },

  configDeps: [iconClassesScript, runtimeIcons],
});
