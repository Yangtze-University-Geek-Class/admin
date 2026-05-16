import { Link } from "react-router-dom";
import ThemeSwitcher from "../components/ThemeSwitcher";

export default function Landing() {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <Link to="/admin/signin" className="btn-primary text-sm">使用 GitHub 登录</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center">
          <div className="inline-flex items-center gap-3 text-brand-500 font-mono text-sm tracking-widest mb-4">
            <span className="w-8 h-px bg-brand-500/50" />
            GITHUB ORG MANAGEMENT
            <span className="w-8 h-px bg-brand-500/50" />
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold text-ink-50 tracking-tight leading-tight">
            一个面板<br />管理你所有的 <span className="text-brand-500">GitHub 组织</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-ink-300 text-lg leading-relaxed">
            用 GitHub 账号登录后，自动展示你 owner / member 的所有组织。
            按组织内角色分权：admin 可改设置、邀请成员、发临时邀请链接；member 可查看不可修改。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link to="/admin/signin" className="btn-primary text-base px-6 py-3">
              进入管理后台
            </Link>
            <Link to="/docs" className="btn-ghost text-base px-6 py-3">
              使用文档
            </Link>
            <Link to="/feedback" className="btn-ghost text-base px-6 py-3">
              提交意见
            </Link>
            <a href="https://github.com/Yangtze-University-Geek-Class" target="_blank" rel="noreferrer" className="btn-ghost text-base px-6 py-3">
              访问 GitHub 组织
            </a>
          </div>
        </div>

        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { title: "总览 / 成员 / 仓库", body: "实时拉取组织面板：成员角色、仓库可见性、分支保护、Webhooks、协作者。" },
            { title: "临时邀请链接", body: "admin 生成带有效期 + 次数限制的链接，任何人凭链接填用户名即可自动收到邀请。" },
            { title: "组织设置同步", body: "默认权限 / 仓库创建 / fork / pages / 删仓 / 改可见性 等开关一处搞定，落地即生效。" },
          ].map((f, i) => (
            <div key={i} className="card p-6">
              <div className="text-2xl text-brand-500 font-mono mb-2">0{i + 1}</div>
              <h3 className="font-semibold text-ink-100 mb-2">{f.title}</h3>
              <p className="text-ink-400 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-8 text-xs text-ink-500">
        Yangtze University Geek Class · 部署于 github.yangtzeu.work
      </footer>
    </div>
  );
}
