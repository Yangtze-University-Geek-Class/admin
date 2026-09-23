import { createApp } from "vue";
// Tuffex 0.6.0 发布包里 breadcrumb、steps、pagination、error-state、permission-state 等 17 个子路径的
// style.css 是空文件，规则只在整包 components.css 里；所以与论坛一样整包引入（已含 base.css 的全部令牌）。
import "@talex-touch/tuffex/style.css";
import "virtual:uno.css";
import "./styles/theme.css";
import "./styles/layout.css";
import App from "./App.vue";
import { router } from "./router";

createApp(App).use(router).mount("#app");
