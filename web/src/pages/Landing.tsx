import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { applyTheme } from "../lib/themes";
import { api, fmtRelative } from "../lib/api";

type Stats = {
  counts: { members: number; threads: number; posts: number; categories: number };
  groups: { id: number; slug: string; name: string; description: string | null; thread_count: number }[];
  recent_threads: {
    id: number; title: string; created_at: number; reply_count: number; view_count: number;
    author: { username: string; display_name: string | null };
    category: { slug: string; name: string };
  }[];
};

export default function Landing() {
  useEffect(() => {
    if (!localStorage.getItem("theme")) applyTheme("yzgc-blue");
  }, []);
  const stats = useQuery({ queryKey: ["forum-stats"], queryFn: () => api<Stats>("/api/forum/stats") });
  const c = stats.data?.counts;
  const groups = stats.data?.groups ?? [];
  const recent = stats.data?.recent_threads ?? [];

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="YUGC" className="w-10 h-10 rounded-lg shadow-sm" />
          <div>
            <div className="font-semibold text-ink-50 text-lg leading-tight">长江大学极客班</div>
            <div className="text-[11px] text-ink-300 tracking-widest leading-tight">YANGTZE UNIVERSITY GEEK CLASS</div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/forum" className="px-3 py-2 text-sm text-ink-100 hover:text-brand-500 transition">论坛</Link>
          <Link to="/docs" className="px-3 py-2 text-sm text-ink-100 hover:text-brand-500 transition">文档</Link>
          <Link to="/admin" className="px-3 py-2 text-sm text-ink-100 hover:text-brand-500 transition">管理后台</Link>
          <Link to="/feedback" className="px-3 py-2 text-sm text-ink-100 hover:text-brand-500 transition">意见箱</Link>
          <span className="mx-2 w-px h-5 bg-ink-600/40" />
          <ThemeSwitcher compact />
          <a href="https://github.com/Yangtze-University-Geek-Class" target="_blank" rel="noreferrer"
            className="btn-primary text-sm px-4 py-2">GitHub 组织</a>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-24 grid lg:grid-cols-[1.2fr_1fr] gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-3 text-brand-500 font-mono text-xs tracking-[0.3em] mb-5">
              <span className="w-10 h-px bg-brand-500/70" />
              YANGTZEU.WORK · GEEK CLASS
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold text-ink-50 leading-[1.05] tracking-tight">
              提前出发的<br/>
              <span className="text-brand-500">技术之路</span>
            </h1>
            <p className="mt-6 text-ink-200 text-lg leading-relaxed max-w-xl">
              长江大学极客班 (YUGC) 是一支学生自治的技术社区。我们提供学习路径、项目协作、竞赛集训和资源共享，帮你在大学里少走弯路。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link to="/forum" className="btn-primary text-base px-7 py-3 shadow-md shadow-brand-500/20">进入论坛</Link>
              <Link to="/docs" className="btn-ghost text-base px-7 py-3">阅读文档</Link>
            </div>
            <div className="mt-12 grid grid-cols-4 gap-6 max-w-lg">
              <Metric label="成员" value={c?.members} />
              <Metric label="主题" value={c?.threads} />
              <Metric label="回帖" value={c?.posts} />
              <Metric label="板块" value={c?.categories} />
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="relative">
              <div className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-brand-500/15 via-transparent to-brand-500/10 blur-2xl" />
              <div className="relative rounded-3xl bg-white/70 backdrop-blur border border-brand-500/15 p-6 shadow-xl shadow-brand-500/10">
                <div className="text-xs font-mono text-brand-500 tracking-widest mb-4 flex items-center justify-between">
                  <span>// LATEST</span>
                  <Link to="/forum" className="text-ink-400 hover:text-brand-500 transition">查看全部 →</Link>
                </div>
                {stats.isLoading && <div className="text-ink-400 text-sm py-8 text-center">加载中…</div>}
                {recent.length === 0 && !stats.isLoading && <div className="text-ink-400 text-sm py-8 text-center">暂无</div>}
                <ul className="divide-y divide-brand-500/10">
                  {recent.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      <Link to={`/forum/t/${t.id}`} className="block py-3 hover:bg-brand-500/5 -mx-2 px-2 rounded transition">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded text-[10px] font-medium bg-brand-500/10 text-brand-500 mt-0.5">{t.category.name}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-ink-100 truncate">{t.title}</div>
                            <div className="text-[11px] text-ink-400 mt-0.5 flex items-center gap-2">
                              <span>{t.author.display_name ?? t.author.username}</span>
                              <span>·</span>
                              <span>{fmtRelative(t.created_at)}</span>
                              <span>·</span>
                              <span>{t.reply_count} 回 · {t.view_count} 阅</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-2">PANELS · 02</div>
            <h2 className="text-3xl font-bold text-ink-50">从这里进入各个面板</h2>
          </div>
          <Link to="/docs" className="text-sm text-brand-500 hover:underline hidden sm:block">查看完整文档 →</Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { to: "/forum", title: "论坛", sub: "经验分享 / 学习资料 / 提问", desc: "讨论区，技术问题、学习路径、竞赛分享，蓝白配色阅读舒适。" },
            { to: "/admin", title: "管理后台", sub: "GitHub 组织管理", desc: "成员、仓库、邀请链接、审计日志，按 GitHub 角色分权。" },
            { to: "/docs", title: "文档", sub: "USAGE / DEPLOY / ARCH", desc: "管理后台与论坛的使用指南，中英文双语。" },
            { to: "/feedback", title: "意见箱", sub: "公开提交 + 后台跟进", desc: "任何人可提，admin 在后台分类、处理、回复。" },
          ].map((c, i) => (
            <Link key={c.to} to={c.to} className="group block card p-6 hover:border-brand-500/40 hover:shadow-lg hover:shadow-brand-500/10 transition">
              <div className="text-brand-500 font-mono text-xs tracking-widest mb-3">0{i + 1}</div>
              <h3 className="text-xl font-bold text-ink-50 mb-1 group-hover:text-brand-500 transition">{c.title}</h3>
              <div className="text-xs text-ink-300 mb-3">{c.sub}</div>
              <p className="text-sm text-ink-200 leading-relaxed">{c.desc}</p>
              <div className="mt-4 text-sm text-brand-500 inline-flex items-center gap-1">
                进入
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 transition group-hover:translate-x-1"><path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" /></svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-2">GROUPS · 03</div>
        <h2 className="text-3xl font-bold text-ink-50 mb-8">兴趣小组</h2>
        {stats.isLoading && <div className="text-ink-400 text-sm">加载中…</div>}
        {groups.length === 0 && !stats.isLoading && <div className="text-ink-400 text-sm">暂无小组数据</div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <Link key={g.id} to={`/forum/c/${encodeURIComponent(g.slug)}`} className="card p-5 hover:border-brand-500/40 hover:shadow-md hover:shadow-brand-500/10 transition block">
              <div className="font-semibold text-ink-50 mb-1">{g.name}</div>
              <div className="text-sm text-ink-300 line-clamp-2">{g.description || "—"}</div>
              <div className="mt-3 text-xs text-brand-500">{g.thread_count} 篇主题 →</div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-brand-500/10 mt-8">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-ink-300">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded" />
            <span>© Yangtze University Geek Class · yangtzeu.work</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="https://github.com/Yangtze-University-Geek-Class" target="_blank" rel="noreferrer" className="hover:text-brand-500 transition">GitHub</a>
            <Link to="/docs" className="hover:text-brand-500 transition">文档</Link>
            <Link to="/feedback" className="hover:text-brand-500 transition">意见箱</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <div className="text-3xl font-bold text-ink-50 tabular-nums">{value ?? "—"}</div>
      <div className="text-xs text-ink-300 mt-1">{label}</div>
    </div>
  );
}
