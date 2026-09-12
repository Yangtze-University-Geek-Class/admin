import { mountSite } from "@shared/lib/mount";
import FeedbackFab from "@shared/ui/FeedbackFab";
import App from "./App";

// 论坛的意见按钮要抬高到看板娘之上，避免遮挡。
mountSite("forum", <App />, { chrome: <FeedbackFab raised /> });
