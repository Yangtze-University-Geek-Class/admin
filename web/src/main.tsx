import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App, { GlobalFab } from "./App";
import { applyTheme, loadTheme } from "./lib/themes";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { detectSite } from "./lib/site";
import "./index.css";

const site = detectSite();
document.title = site.title;
const initialTheme = site.allowThemeSwitch
  ? loadTheme(site.defaultTheme)
  : site.defaultTheme;
applyTheme(site.themePalette.includes(initialTheme) ? initialTheme : site.defaultTheme);

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <BrowserRouter>
          <App />
          <GlobalFab />
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
