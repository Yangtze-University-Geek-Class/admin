import { mountSite } from "@shared/lib/mount";
import App from "./App";

// 官网是纯匿名站点，不挂意见悬浮按钮（页面上有独立的反馈入口）。
mountSite("portal", <App />);
