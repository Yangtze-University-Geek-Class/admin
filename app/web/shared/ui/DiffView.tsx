type Props = { patch: string | null };

export default function DiffView({ patch }: Props) {
  if (!patch) return <div className="text-ink-500 text-xs px-4 py-3">无 diff（二进制 / 重命名 / 过大）</div>;
  const lines = patch.split("\n");
  return (
    <pre className="text-xs font-mono overflow-auto bg-ink-950/60 rounded border border-ink-800/60">
      {lines.map((line, i) => {
        let cls = "text-ink-300";
        let bg = "";
        if (line.startsWith("@@")) { cls = "text-brand-500"; bg = "bg-brand-500/10"; }
        else if (line.startsWith("+") && !line.startsWith("+++")) { cls = "text-emerald-300"; bg = "bg-emerald-500/10"; }
        else if (line.startsWith("-") && !line.startsWith("---")) { cls = "text-rose-300"; bg = "bg-rose-500/10"; }
        else if (line.startsWith("+++") || line.startsWith("---")) { cls = "text-ink-500"; }
        return (
          <div key={i} className={`px-3 py-px ${bg}`}>
            <span className={cls}>{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}
