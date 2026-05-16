import { useLocation } from "react-router-dom";
import ThemeSwitcher from "../../components/ThemeSwitcher";

export default function SignIn() {
  const loc = useLocation();
  const returnTo = new URLSearchParams(loc.search).get("return_to") ?? "/admin";

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <a href="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin</span>
        </a>
        <ThemeSwitcher />
      </header>
      <div className="flex items-center justify-center px-4 py-16">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-brand-500/15 text-brand-500 items-center justify-center mb-5">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.45.11-3.02 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39s1.98.13 2.9.39c2.21-1.49 3.18-1.18 3.18-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.83 1.18 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.13v3.15c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-ink-50 mb-2">登录管理后台</h2>
          <p className="text-ink-400 text-sm mb-8">用 GitHub 授权，登录后可管理你 owner / 加入的所有组织</p>
          <a href={`/auth/github?return_to=${encodeURIComponent(returnTo)}`} className="btn-primary w-full py-3 text-base">
            使用 GitHub 登录
          </a>
          <p className="text-xs text-ink-500 mt-6">权限：read:user · user:email · admin:org · read:org</p>
        </div>
      </div>
    </div>
  );
}
