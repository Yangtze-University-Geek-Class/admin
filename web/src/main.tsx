// App entry: site detection -> theme -> QueryClient -> providers -> router.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App, { GlobalFab } from "./App";
import { applyTheme, loadTheme } from "@shared/lib/themes";
import { ConfirmProvider } from "@shared/ui/ConfirmDialog";
import { detectSite } from "@shared/lib/site";
import ImageLightbox from "@shared/ui/ImageLightbox";
import DevControlCenter from "@shared/ui/DevControlCenter";
import { runtimeFeatures } from "@shared/config";
import "@shared/styles/base.css";

const site = detectSite();
const features = runtimeFeatures();
document.title = site.title;
document.documentElement.dataset.site = site.kind;
applyTheme(loadTheme("yzgc-blue"));

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <BrowserRouter basename={site.basePath || undefined}>
          <App />
          {features.feedbackFab && <GlobalFab />}
          <ImageLightbox />
          <DevControlCenter />
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
