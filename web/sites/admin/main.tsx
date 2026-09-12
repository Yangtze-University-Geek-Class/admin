import { mountSite } from "@shared/lib/mount";
import FeedbackFab from "@shared/ui/FeedbackFab";
import App from "./App";

// 后台的意见按钮用默认位置。
mountSite("admin", <App />, { chrome: <FeedbackFab /> });
