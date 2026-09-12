import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@shared/lib/api";
import Select from "@shared/ui/Select";

const GITIGNORE_OPTS = [
  "", "Node", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "C", "C++", "Ruby", "Elixir", "Haskell", "VisualStudio", "Unity", "Android",
];
const LICENSE_OPTS = [
  { value: "", label: "无 license" },
  { value: "mit", label: "MIT" },
  { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GPL 3.0" },
  { value: "bsd-3-clause", label: "BSD 3-Clause" },
  { value: "agpl-3.0", label: "AGPL 3.0" },
  { value: "mpl-2.0", label: "Mozilla Public License 2.0" },
  { value: "unlicense", label: "Unlicense" },
];

export default function CreateRepo() {
  const { org } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "", description: "", visibility: "private" as "public" | "private",
    auto_init: true, gitignore_template: "", license_template: "",
  });

  const create = useMutation({
    mutationFn: () => api<{ ok: boolean; repo: { name: string } }>(`/api/admin/${org}/create-repo`, {
      method: "POST", body: JSON.stringify(form),
    }),
    onSuccess: (r) => navigate(`/admin/${org}/repos/${r.repo.name}`),
  });

  return (
    <div className="p-6 sm:p-8 max-w-2xl mx-auto">
      <Link to={`/admin/${org}/repos`} className="text-sm text-ink-500 hover:text-brand-500">← 仓库列表</Link>
      <h1 className="text-2xl font-semibold text-ink-50 mt-3 mb-6">新建仓库</h1>

      <form className="card p-6 space-y-5" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div>
          <label className="label">仓库名 <span className="text-rose-400">*</span></label>
          <div className="flex items-center gap-2">
            <span className="text-ink-500 font-mono text-sm">{org}/</span>
            <input className="input font-mono" required pattern="[a-zA-Z0-9._\-]+" placeholder="my-project"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <p className="text-xs text-ink-500 mt-1">只能含字母数字 . _ -</p>
        </div>

        <div>
          <label className="label">描述</label>
          <textarea className="input min-h-[60px]" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div>
          <label className="label">可见性</label>
          <div className="grid grid-cols-2 gap-2">
            {(["private", "public"] as const).map((v) => (
              <button type="button" key={v}
                onClick={() => setForm({ ...form, visibility: v })}
                className={`p-3 rounded-lg border transition text-left ${
                  form.visibility === v ? "border-brand-500/60 bg-brand-500/10" : "border-ink-700/60 hover:bg-ink-800/40"
                }`}>
                <div className="font-mono text-sm text-ink-100">{v}</div>
                <div className="text-xs text-ink-500 mt-1">
                  {v === "private" ? "只有组织成员可见" : "全网可见，任何人可 fork"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 p-3 rounded border border-ink-700/60 hover:bg-ink-800/40 cursor-pointer">
          <input type="checkbox" className="accent-brand-500 w-4 h-4" checked={form.auto_init}
            onChange={(e) => setForm({ ...form, auto_init: e.target.checked })} />
          <div className="flex-1">
            <div className="text-sm text-ink-100">初始化 README</div>
            <div className="text-xs text-ink-500">关掉的话仓库会是空的，需要本地 push 才能初始化</div>
          </div>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">.gitignore 模板</label>
            <Select value={form.gitignore_template}
              onChange={(v) => setForm({ ...form, gitignore_template: v })}
              options={GITIGNORE_OPTS.map((g) => ({ value: g, label: g || "— 不添加 —" }))} />
          </div>
          <div>
            <label className="label">License</label>
            <Select value={form.license_template}
              onChange={(v) => setForm({ ...form, license_template: v })}
              options={LICENSE_OPTS} />
          </div>
        </div>

        {create.error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm px-4 py-3">
            {(create.error as Error).message}
          </div>
        )}

        <button type="submit" className="btn-primary w-full py-3" disabled={!form.name || create.isPending}>
          {create.isPending ? "创建中…" : "创建仓库"}
        </button>
      </form>
    </div>
  );
}
