import { createApp } from "vue";
// Tuffex 0.9.1 发布包里 error-state、permission-state、empty、loading-state 等 18 个子路径的
// style.css 是空文件，规则只在整包 components.css 里；所以与论坛一样整包引入（已含 base.css 的全部令牌）。
import "@talex-touch/tuffex/style.css";
import "virtual:uno.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/controls.css";
import { setSurfacePerformanceMode } from "@talex-touch/tuffex/base-surface";
import App from "./App.vue";
import { router } from "./router";

// 弹窗、抽屉、下拉的面板默认是 refraction 玻璃材质，会透出背后的页面（所有者 2026-10-24 提出下拉框不要这种样式）。
// 这个开关让整页的 refraction、glass、acrylic、blur、mica 都画成不透明的 flat。
setSurfacePerformanceMode("max");

createApp(App).use(router).mount("#app");
