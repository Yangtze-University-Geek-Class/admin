// 文档、意见箱、邀请加入三张普通页面的外壳：和 YUGC OS 同一套浅色语言（纸色底 + 淡图纸线 + 窗口式卡片）。
// 顶部是一条细的「系统栏」：品牌 + 回到桌面 + 三个主入口；底部一行版权与链接。不放吉祥物插画。
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { appConfig } from "@shared/config";
import { RESUME_DESKTOP, links } from "../lib/links";
import Icon from "./Icon";
import "../styles/portal.css";
import "../styles/pages.css";

export default function PageShell({ path, children }: { path: string; children: ReactNode }) {
  const { brand } = appConfig.portal;
  return (
    <div className="pt-root pt-page">
      <header className="pt-pagebar">
        <Link className="pt-pagebar-brand" to="/" aria-label={`返回${brand.title}首页`}>
          <img src={brand.logo} alt="" width={28} height={28} />
          <span>
            <b>{brand.title}</b>
            <small>{path}</small>
          </span>
        </Link>
        <nav className="pt-pagebar-nav" aria-label="主导航">
          <NavLink to="/docs">文档</NavLink>
          <NavLink to="/feedback">意见箱</NavLink>
          <a href={links.forumHome()}>论坛</a>
          <Link className="pt-btn is-primary is-sm" to="/join-us">
            <Icon name="mail-send-line" size={15} /> 加入我们
          </Link>
        </nav>
      </header>
      <main className="pt-page-main">{children}</main>
      <footer className="pt-pagefoot">
        <span>
          © {brand.title} · {brand.subtitle}
        </span>
        <nav aria-label="页脚导航">
          <Link to="/" state={RESUME_DESKTOP}>
            回到桌面
          </Link>
          <Link to="/join-us">加入我们</Link>
          <a href={links.forumHome()}>论坛</a>
          <Link to="/docs">文档</Link>
          <a href={links.console()}>控制台</a>
          <a href={links.githubOrg()} target="_blank" rel="noreferrer">
            GitHub 组织
          </a>
        </nav>
      </footer>
    </div>
  );
}

/** 窗口样式的卡片：标题栏（三点 + 路径 + 状态）+ 内容 */
export function WindowCard({ path, badge, className, children }: { path: string; badge?: string; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `pt-wcard ${className}` : "pt-wcard"}>
      <div className="pt-wcard-bar" aria-hidden="true">
        <span className="pt-wcard-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="pt-wcard-path">{path}</span>
        {badge && <span className="pt-wcard-badge">{badge}</span>}
      </div>
      <div className="pt-wcard-body">{children}</div>
    </section>
  );
}
