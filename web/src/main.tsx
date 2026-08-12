import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App, { GlobalFab } from "./App";
import { applyTheme, loadTheme } from "./lib/themes";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { detectSite } from "./lib/site";
import ImageLightbox from "./components/ImageLightbox";
import "./index.css";
import "./portal.css";

const site = detectSite();
document.title = site.title;
document.documentElement.dataset.site = site.kind;
const initialTheme = site.allowThemeSwitch
  ? loadTheme(site.defaultTheme)
  : site.defaultTheme;
applyTheme(site.themePalette.includes(initialTheme) ? initialTheme : site.defaultTheme);

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
          <GlobalFab />
          <ImageLightbox />
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
