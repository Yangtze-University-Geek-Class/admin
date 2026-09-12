// 三端共用的挂载逻辑。
//
// 每个端有自己的 main.tsx（web/sites/<端>/main.tsx），它们只负责声明
// 「我是哪个端、路由前缀是什么、要不要挂意见悬浮按钮」，其余（主题、QueryClient、
// ConfirmProvider、Lightbox、开发总控）都在这里统一装好，避免三份复制。
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConfirmProvider } from "../ui/ConfirmDialog";
import ImageLightbox from "../ui/ImageLightbox";
import DevControlCenter from "../ui/DevControlCenter";
import { applyTheme, loadTheme } from "./themes";
import { getBasePath } from "./site-kind";
import { appConfig, type AppSiteKind } from "../config";

import "@shared/styles/base.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: false,
    },
  },
});

export type MountOptions = {
  /** 站点标题，写入 document.title */
  title?: string;
  /** 额外挂在路由内部的全局元素，如意见悬浮按钮 */
  chrome?: ReactNode;
};

/**
 * 挂载一个端。`kind` 决定 basename（论坛可能挂在 /forum 路径下）与默认标题。
 */
export function mountSite(kind: AppSiteKind, app: ReactNode, options: MountOptions = {}) {
  const { title = appConfig.sites[kind].title, chrome } = options;

  document.title = title;
  applyTheme(loadTheme("yzgc-blue"));

  const root = document.getElementById("root");
  if (!root) throw new Error("#root not found in the page");

  const basename = getBasePath(kind);

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <BrowserRouter basename={basename || undefined}>
            {app}
            {chrome}
            <ImageLightbox />
            <DevControlCenter />
          </BrowserRouter>
        </ConfirmProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
