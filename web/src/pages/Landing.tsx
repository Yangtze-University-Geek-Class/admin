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
  { title: "项目驱动", body: "比起跟教学进度，我们更相信「做出一个能跑的东西」。" },
  { title: "学长带学弟", body: "新生一进来就接触实际项目和真实代码，少绕弯。" },
  { title: "开源共建", body: "组织所有工具、论坛、管理后台都开源在 GitHub，欢迎 PR。" },
  { title: "竞赛集训", body: "ACM、CTF、AI、嵌入式等方向有学长牵头组队。" },
];

const GROUPS = [
  { name: "算法与应用", desc: "ACM / Leetcode / 工程算法落地" },
  { name: "深度学习", desc: "PyTorch / 论文复现 / 模型部署" },
  { name: "嵌入式", desc: "MCU / RTOS / IoT 协议" },
  { name: "信安", desc: "CTF / Web 渗透 / 二进制" },
  { name: "爬虫与数据分析", desc: "采集 / 清洗 / 可视化" },
  { name: "C 语言", desc: "新生筑基 · 系统编程入门" },
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
          提前出发的<br />
          <span className="text-brand-500">技术之路</span>
        </h1>
        <p className="mt-6 text-ink-200 text-lg leading-relaxed max-w-2xl">
          长江大学极客班 (YUGC) 是一支学生自治的技术社区。
          从这里出发，进入论坛交流、阅读文档、查看管理后台或访问 GitHub 组织。
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
        <div className="text-brand-500 font-mono text-xs tracking-[0.3em] mb-3">GROUPS · 03</div>
        <h2 className="text-2xl font-bold text-ink-50 mb-6">兴趣小组</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GROUPS.map((g) => (
            <div key={g.name} className="card p-4">
              <div className="font-medium text-ink-50">{g.name}</div>
              <div className="text-sm text-ink-300 mt-0.5">{g.desc}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-400 mt-5">
          想详细了解、加入小组或发起话题，请到 <a href={externalUrl("forum", "/")} className="text-brand-500 hover:underline">论坛</a>。
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
