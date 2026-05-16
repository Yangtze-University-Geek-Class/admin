import { Link } from "react-router-dom";
import { externalUrl } from "../lib/site";

const ENTRIES = [
  {
    title: "论坛",
    sub: "Forum · 经验分享 / 学习资料 / 提问",
    desc: "技术讨论、学习路径、竞赛分享。老论坛数据完整迁入，原账号继续可用。",
    href: () => externalUrl("forum", "/"),
    external: true,
  },
  {
    title: "管理后台",
    sub: "Admin · GitHub 组织管理",
    desc: "成员、仓库、邀请链接、审计日志。按 GitHub 角色分权。",
    href: () => externalUrl("admin", "/admin"),
    external: true,
  },
  {
    title: "文档",
    sub: "Docs · 使用 / 部署 / 架构",
    desc: "论坛、管理后台、CLI 的中文 / 英文文档。",
    href: () => "/docs",
    external: false,
  },
  {
    title: "GitHub 组织",
    sub: "github.com/Yangtze-University-Geek-Class",
    desc: "源代码、仓库、Issue / PR 全部公开。",
    href: () => "https://github.com/Yangtze-University-Geek-Class",
    external: true,
  },
];

const PILLARS = [
  { title: "AI Native", body: "默认以 LLM / Agent / MCP 作为开发与协作底座，不是把 AI 当外挂。" },
  { title: "项目驱动", body: "围绕真实工程产出学习，不刷题不内卷绩点。" },
  { title: "开源共建", body: "论坛、管理后台、CLI、Skill 全部开源在 GitHub，组织成员共维护。" },
  { title: "学长带学弟", body: "新生进来就接触 Agent 工作流、Prompt 工程和工程化协作，少绕弯。" },
];

const FOCUS = [
  { title: "模型与基础", desc: "新模型、benchmark、scaling、推理优化", to: "/forum/c/models" },
  { title: "Agent 与 MCP", desc: "Agent 框架、MCP server、工具调用、orchestration", to: "/forum/c/agent-mcp" },
  { title: "AI Coding", desc: "Claude Code · Cursor · Aider · Codex 实战与 Skill", to: "/forum/c/ai-coding" },
  { title: "Prompt 与上下文工程", desc: "Prompt 设计、CoT、RAG、上下文管理", to: "/forum/c/prompt" },
  { title: "应用与产品", desc: "AI-first 产品 case study、设计、商业化", to: "/forum/c/products" },
  { title: "求助与资源", desc: "新手提问、论文、教程、开源项目分享", to: "/forum/c/help-resources" },
];

export default function Landing() {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="YUGC" className="w-10 h-10 rounded-lg shadow-sm" />
          <div>
            <div className="font-semibold text-ink-50 text-lg leading-tight">长江大学极客班</div>
            <div className="text-[11px] text-ink-300 tracking-widest leading-tight">YANGTZE UNIVERSITY GEEK CLASS</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/docs" className="px-3 py-2 text-ink-100 hover:text-brand-500 transition">文档</Link>
          <a href={externalUrl("forum", "/")} className="px-3 py-2 text-ink-100 hover:text-brand-500 transition">论坛</a>
          <a href={externalUrl("admin", "/admin")} className="px-3 py-2 text-ink-100 hover:text-brand-500 transition">管理后台</a>
          <a href="https://github.com/Yangtze-University-Geek-Class" target="_blank" rel="noreferrer"
            className="btn-primary text-sm px-4 py-2 ml-2">GitHub</a>
        </nav>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-10 pb-16">
        <div className="inline-flex items-center gap-3 text-brand-500 font-mono text-xs tracking-[0.3em] mb-5">
          <span className="w-10 h-px bg-brand-500/70" />
          PORTAL · yangtzeu.work
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-ink-50 leading-[1.05] tracking-tight max-w-3xl">
          长江大学的<br />
          <span className="text-brand-500">AI Native 校内组织</span>
        </h1>
        <p className="mt-6 text-ink-200 text-lg leading-relaxed max-w-2xl">
          YUGC (Yangtze University Geek Class) 是长江大学校内的 AI Native 组织。
          我们围绕 LLM、Agent、MCP、AI Coding、Prompt 工程组织讨论、共建工具、跑项目，让 AI 成为每个成员的默认工作方式。
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-3">DESTINATIONS · 01</div>
        <h2 className="text-2xl font-bold text-ink-50 mb-6">前往各个站点</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ENTRIES.map((e, i) => {
            const url = e.href();
            const inner = (
              <>
                <div className="text-brand-500 font-mono text-xs tracking-widest mb-3">0{i + 1}</div>
                <h3 className="text-xl font-bold text-ink-50 mb-1 group-hover:text-brand-500 transition">{e.title}</h3>
                <div className="text-xs text-ink-300 mb-3">{e.sub}</div>
                <p className="text-sm text-ink-200 leading-relaxed">{e.desc}</p>
                <div className="mt-4 text-sm text-brand-500 inline-flex items-center gap-1">
                  前往
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 transition group-hover:translate-x-1"><path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" /></svg>
                </div>
              </>
            );
            if (e.external || url.startsWith("http")) {
              return (
                <a key={e.title} href={url} target={url.startsWith("http") && !url.includes("yangtzeu.work") ? "_blank" : "_self"} rel="noreferrer"
                  className="group block card p-6 hover:border-brand-500/40 hover:shadow-lg hover:shadow-brand-500/10 transition">{inner}</a>
              );
            }
            return (
              <Link key={e.title} to={url} className="group block card p-6 hover:border-brand-500/40 hover:shadow-lg hover:shadow-brand-500/10 transition">{inner}</Link>
            );
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-3">MANIFESTO · 02</div>
        <h2 className="text-2xl font-bold text-ink-50 mb-6">我们相信什么</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((p) => (
            <div key={p.title} className="card p-5">
              <div className="font-semibold text-ink-50 mb-2">{p.title}</div>
              <div className="text-sm text-ink-300 leading-relaxed">{p.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-3">FOCUS · 03</div>
        <h2 className="text-2xl font-bold text-ink-50 mb-6">我们在讨论什么</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FOCUS.map((f) => (
            <a key={f.title} href={externalUrl("forum", f.to.replace(/^\/forum/, ""))}
              className="card p-4 hover:border-brand-500/40 hover:shadow-md hover:shadow-brand-500/10 transition block">
              <div className="font-medium text-ink-50">{f.title}</div>
              <div className="text-sm text-ink-300 mt-0.5">{f.desc}</div>
            </a>
          ))}
        </div>
        <p className="text-xs text-ink-400 mt-5">
          以上是论坛的 6 个常驻板块。要发帖、回帖、加入讨论，进 <a href={externalUrl("forum", "/")} className="text-brand-500 hover:underline">论坛</a>。
        </p>
      </section>

      <footer className="border-t border-brand-500/10 mt-8">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-ink-300">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded" />
            <span>© Yangtze University Geek Class · yangtzeu.work</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="https://github.com/Yangtze-University-Geek-Class" target="_blank" rel="noreferrer" className="hover:text-brand-500 transition">GitHub</a>
            <Link to="/docs" className="hover:text-brand-500 transition">文档</Link>
            <a href={externalUrl("forum", "/")} className="hover:text-brand-500 transition">论坛</a>
            <a href={externalUrl("admin", "/admin")} className="hover:text-brand-500 transition">管理后台</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
