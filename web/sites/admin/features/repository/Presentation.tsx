import { useMemo, useState } from "react";
import Select from "@shared/ui/Select";
import DiffView from "@shared/ui/DiffView";
import { renderMarkdown } from "@shared/lib/markdown";

export function BranchPicker({ branches, value, onChange }: { branches: { name: string; protected: boolean }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select size="sm" value={value} onChange={onChange}
      options={branches.map((b) => ({ value: b.name, label: b.name, hint: b.protected ? "protected" : undefined }))} />
  );
}

export function CollapsibleFileBody({ content }: { content: string }) {
  const lines = content.split("\n");
  const long = lines.length > 200;
  const [expanded, setExpanded] = useState(!long);
  const shown = expanded ? content : lines.slice(0, 200).join("\n");
  return (
    <div>
      <pre className="text-xs font-mono overflow-auto p-4 max-h-[70vh] leading-relaxed text-ink-200">{shown}</pre>
      {long && (
        <div className="border-t border-ink-800/60 px-4 py-2 flex items-center justify-between text-xs">
          <span className="text-ink-400">{lines.length} 行 · {expanded ? "已展开" : `显示前 200 行`}</span>
          <button onClick={() => setExpanded(!expanded)} className="text-brand-500 hover:underline">
            {expanded ? "折叠" : "展开全部"}
          </button>
        </div>
      )}
    </div>
  );
}

export function CollapsibleFile({ file, defaultOpen }: { file: any; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const lineCount = file.patch ? file.patch.split("\n").length : 0;
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-ink-900/40 border-b border-ink-800/60 text-sm hover:bg-ink-900/60 transition text-left">
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-ink-400 transition ${open ? "rotate-90" : ""}`}>
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        <span className={`tag-${file.status === "added" ? "green" : file.status === "removed" ? "red" : "blue"}`}>{file.status}</span>
        <span className="font-mono text-ink-200 flex-1 truncate">{file.filename}</span>
        {lineCount > 0 && <span className="text-[11px] text-ink-500">{lineCount} 行</span>}
        <span className="text-emerald-400 text-xs">+{file.additions}</span>
        <span className="text-rose-400 text-xs">-{file.deletions}</span>
      </button>
      {open && <DiffView patch={file.patch} />}
    </div>
  );
}

export function FilesBulkToggle({ filesCount }: { filesCount: number }) {
  return (
    <div className="text-xs text-ink-400">
      {filesCount > 3 ? "默认折叠，点行展开" : ""}
    </div>
  );
}

export function MarkdownBox({ src }: { src: string | null }) {
  const html = useMemo(() => (src ? renderMarkdown(src) : ""), [src]);
  if (!src) return <p className="text-ink-500 text-sm italic">无正文</p>;
  return <div className="prose-doc text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}
