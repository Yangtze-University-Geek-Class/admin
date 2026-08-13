// Development-only control center (site / data-source / page switcher).
// Rendered only when environment.development.showControlCenter is true; never in production.
import { runtimeEnvironment, type AppSiteKind, type DataSource } from "../config";
import { detectSite } from "../lib/site";
import { getDataSource, setDataSource, setSiteOverride } from "../lib/runtime";

const SITE_OPTIONS: Array<{ value: AppSiteKind; label: string }> = [
  { value: "portal", label: "官网" },
  { value: "forum", label: "论坛" },
  { value: "admin", label: "管理后台" },
];

export default function DevControlCenter() {
  const runtime = runtimeEnvironment();
  if (!runtime.showControlCenter) return null;

  const site = detectSite().kind;
  const source = getDataSource();

  const openPath = (path: string) => {
    const url = new URL(window.location.href);
    url.pathname = path;
    window.location.assign(url.toString());
  };

  const openSite = (target: AppSiteKind) => {
    if (target === "admin") {
      localStorage.setItem("yugc:dev-site", target);
      const url = new URL(window.location.href);
      url.pathname = "/admin";
      url.searchParams.set("__site", target);
      window.location.assign(url.toString());
      return;
    }
    setSiteOverride(target);
  };

  return (
    <aside className="dev-control-center" aria-label="开发环境总控">
      <div className="dev-control-head">
        <span><i /> DEV CONTROL</span>
        <b>{source === "mock" ? "MOCK" : "LIVE"}</b>
      </div>
      <div className="dev-control-row">
        <span className="dev-control-label">站点</span>
        {SITE_OPTIONS.map((option) => (
          <button key={option.value} type="button" className={site === option.value ? "is-active" : ""} onClick={() => openSite(option.value)}>
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
        <button type="button" onClick={() => openPath(site === "admin" ? "/admin" : "/")}>首页</button>
        {site === "forum" && <><button type="button" onClick={() => openPath("/categories")}>分类</button><button type="button" onClick={() => openPath("/t/101")}>帖子</button><button type="button" onClick={() => openPath("/admin")}>论坛管理</button></>}
        {site === "admin" && <><button type="button" onClick={() => openPath("/admin/Yangtze-University-Geek-Class")}>组织总览</button><button type="button" onClick={() => openPath("/admin/Yangtze-University-Geek-Class/repos")}>仓库</button></>}
      </div>
      <p>开发环境默认拦截前端请求并返回本地样板数据；生产构建始终使用真实 API。</p>
    </aside>
  );
}
