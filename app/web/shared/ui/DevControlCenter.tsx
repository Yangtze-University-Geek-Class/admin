// Development-only control center (site / data-source / page switcher).
// Rendered only when environment.development.showControlCenter is true; never in production.
// 默认收起成左下角的小胶囊，点开才展开面板，不遮挡页面内容（官网全屏场景、系统桌面的 Dock 都在底部中间与右侧）。
import { useState } from "react";
import { runtimeEnvironment, type AppSiteKind, type DataSource } from "../config";
import { crossSiteHref, getCurrentSite, getDataSource, setDataSource } from "../lib/runtime";

const SITE_OPTIONS: Array<{ value: AppSiteKind; label: string }> = [
  { value: "portal", label: "官网" },
  { value: "forum", label: "论坛" },
  { value: "admin", label: "控制台" },
];

export default function DevControlCenter() {
  const runtime = runtimeEnvironment();
  if (!runtime.showControlCenter) return null;
  return <DevControlPanel />;
}

function DevControlPanel() {
  const [open, setOpen] = useState(false);
  const site = getCurrentSite();
  const source = getDataSource();

  // 开发态每个端是独立的 HTML 入口，站内跳转要带上 /sites/<端> 前缀
  const openPath = (path: string) => window.location.assign(crossSiteHref(site, path));

  if (!open) {
    return (
      <button type="button" className="dev-control-pill" aria-label="展开开发环境总控" aria-expanded="false" onClick={() => setOpen(true)}>
        <i /> DEV · {source === "mock" ? "MOCK" : "LIVE"}
      </button>
    );
  }

  return (
    <aside className="dev-control-center" aria-label="开发环境总控">
      <div className="dev-control-head">
        <span><i /> DEV CONTROL</span>
        <b>{source === "mock" ? "MOCK" : "LIVE"}</b>
        <button type="button" className="dev-control-close" aria-label="收起开发环境总控" aria-expanded="true" onClick={() => setOpen(false)}>
          收起
        </button>
      </div>
      <div className="dev-control-row">
        <span className="dev-control-label">站点</span>
        {SITE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={site === option.value ? "is-active" : ""}
            onClick={() => window.location.assign(crossSiteHref(option.value, "/"))}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="dev-control-row">
        <span className="dev-control-label">数据</span>
        {(["mock", "live"] as DataSource[]).map((value) => (
          <button key={value} type="button" className={source === value ? "is-active" : ""} onClick={() => setDataSource(value)}>
            {value === "mock" ? "样板数据" : "真实 API"}
          </button>
        ))}
      </div>
      <div className="dev-control-row dev-control-pages">
        <span className="dev-control-label">页面</span>
        <button type="button" onClick={() => openPath(site === "admin" ? "/console" : "/")}>首页</button>
        {site === "forum" && <><button type="button" onClick={() => openPath("/categories")}>分类</button><button type="button" onClick={() => openPath("/t/101")}>帖子</button><button type="button" onClick={() => openPath("/admin")}>论坛管理</button></>}
        {site === "admin" && <><button type="button" onClick={() => openPath("/console/people")}>成员与权限</button><button type="button" onClick={() => openPath("/console/github/repos")}>仓库</button></>}
      </div>
      <p>开发环境默认拦截前端请求并返回本地样板数据；生产构建始终使用真实 API。</p>
    </aside>
  );
}
