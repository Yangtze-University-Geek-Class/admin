// 官网「文档」页：公开产品介绍与用户指南（白名单由 /api/docs 决定）。
// 外壳是 ../components/PageShell.tsx（与 YUGC OS 同一套浅色语言）。
import { useEffect, useMemo, useRef } from "react";
import { useProseInteractions } from "@shared/ui/ImageLightbox";
import { getBasePath } from "@shared/lib/runtime";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/lib/api";
import { renderMarkdown } from "@shared/lib/markdown";
import Icon from "../components/Icon";
import PageShell, { WindowCard } from "../components/PageShell";

type Item = { id: string; label: string; lang: "zh" | "en"; file?: string };
type Doc = { id: string; label: string; lang: "zh" | "en"; file: string; content: string };

export default function Docs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const itemsQuery = useQuery({ queryKey: ["docs"], queryFn: () => api<{ items: Item[] }>("/api/docs") });
  const items = itemsQuery.data?.items ?? [];

  // Language is derived from the current doc's id — not a separate state. This
  // way the language toggle and the article are always in sync.
  const currentItem = items.find((i) => i.id === id);
  const lang: "zh" | "en" = currentItem?.lang ?? "zh";

  const current = useQuery({
    queryKey: ["doc", id],
    queryFn: () => api<Doc>(`/api/docs/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!id && items.length) {
      const def = items.find((i) => i.lang === "zh") ?? items[0];
      navigate(`/docs/${def.id}`, { replace: true });
    }
  }, [id, items, navigate]);

  const switchLang = (target: "zh" | "en") => {
    if (target === lang) return;
    if (!id) return;
    // Map current doc to its sibling in the target language.
    // Convention: zh ids have no suffix; en ids end in "-en". Map both ways.
    const base = id.endsWith("-en") ? id.slice(0, -3) : id;
    const targetId = target === "en" ? `${base}-en` : base;
    const found = items.find((i) => i.id === targetId);
    if (found) {
      navigate(`/docs/${found.id}`);
    } else {
      // Fallback: jump to the first doc of the target language.
      const first = items.find((i) => i.lang === target);
      if (first) navigate(`/docs/${first.id}`);
    }
  };

  const filtered = items.filter((i) => i.lang === lang);

  const html = useMemo(() => {
    if (!current.data?.content) return "";
    return renderMarkdown(current.data.content, {
      resolveAsset: path => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path) || !current.data?.file) return null;
        const target = new URL(path, `https://docs.invalid/${current.data.file}`);
        const linked = items.find(item => item.file === target.pathname.slice(1));
        return linked ? `${getBasePath("portal")}/docs/${linked.id}${target.hash}` : null;
      },
    });
  }, [current.data?.content, current.data?.file, items]);

  const articleRef = useRef<HTMLElement>(null);
  useProseInteractions(articleRef, [html]);

  return (
    <PageShell path="~/yugc/docs">
      <header className="pt-pagehead">
        <div>
          <h1>{currentItem?.label ?? "文档"}</h1>
        </div>
        <div className="pt-segment" role="group" aria-label="文档语言">
          {(["zh", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => switchLang(l)} aria-pressed={lang === l} className={lang === l ? "is-on" : undefined}>
              {l === "zh" ? "中文" : "English"}
            </button>
          ))}
        </div>
      </header>

      <div className="pt-docs">
        <nav className="pt-docs-nav" aria-label="文档目录">
          {filtered.map((it) => (
            <Link key={it.id} to={`/docs/${it.id}`} aria-current={it.id === id ? "page" : undefined}>
              {it.label}
            </Link>
          ))}
          {items.length === 0 && !itemsQuery.isLoading && <p className="pt-hint">{itemsQuery.error ? "目录没加载出来，请刷新页面。" : "还没有公开文档。"}</p>}
        </nav>

        <WindowCard path={current.data ? `~/docs/${current.data.file}` : "~/docs"} className="pt-doc">
          {current.isLoading && <p className="pt-hint">正在读取文档…</p>}
          {current.error && (
            <p className="pt-alert is-error" role="alert">
              <Icon name="error-warning-line" size={16} /> 这篇文档没打开：{(current.error as Error).message}。从左边目录换一篇试试。
            </p>
          )}
          {current.data && <article ref={articleRef} className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />}
        </WindowCard>
      </div>
    </PageShell>
  );
}
