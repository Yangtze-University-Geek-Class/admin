// 终端窗口的内容（#279）：命令都在 lib/shell 的模拟 Linux 里跑，这里只管显示、键盘和打开应用。
// Windows.tsx 打开终端窗口时才加载这个文件，模拟 Linux 不进桌面首屏。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account } from "../../lib/account";
import { useCodeRepos } from "../../lib/codeRepos";
import type { OsApp } from "../../lib/osApps";
import { MOTD, createShell, type TermLine } from "../../lib/shell";
import { toSpans } from "../../lib/shell/ansi";
import type { OpenApp } from "./Windows";

const MAX_LINES = 1000;

/** 一行终端输出：颜色码换成样式，https 地址换成新标签页链接 */
function TermText({ text }: { text: string }) {
  return (
    <>
      {toSpans(text).map((span, index) => {
        const className = [span.bold ? "is-b" : "", span.color ? `is-c${span.color}` : ""].filter(Boolean).join(" ") || undefined;
        return span.href ? (
          <a key={index} className={className} href={span.href} target="_blank" rel="noreferrer">
            {span.text}
          </a>
        ) : (
          <span key={index} className={className}>
            {span.text}
          </span>
        );
      })}
    </>
  );
}

/** 提示符：用户@主机 绿色，目录蓝色，和 Ubuntu 默认的一样 */
function Prompt({ text }: { text: string }) {
  const at = text.indexOf(":");
  return (
    <span className="pt-term-ps">
      <b>{text.slice(0, at)}</b>:<i>{text.slice(at + 1, -1)}</i>$
    </span>
  );
}

export default function Terminal({ onOpen, onClose, onTitle, apps, account }: { onOpen: OpenApp; onClose: () => void; onTitle: (title: string) => void; apps: readonly OsApp[]; account: Account | null }) {
  const repos = useCodeRepos(account, true);
  const appKey = apps.map((app) => app.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 换了登录身份或应用清单才重建，家目录跟着用户名走
  const shell = useMemo(() => createShell({ account, apps }), [account?.accountId, account?.level, account?.username, appKey]);
  const [lines, setLines] = useState<TermLine[]>(() => MOTD.map((text) => ({ kind: "out", text })));
  const [value, setValue] = useState("");
  const [prompt, setPrompt] = useState(shell.prompt());
  const cursor = useRef<number | null>(null);
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    shell.setRepos(repos.status === "ready" ? repos.projects : []);
  }, [repos, shell]);
  useEffect(() => {
    setPrompt(shell.prompt());
    onTitle(shell.title());
  }, [shell, onTitle]);
  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [lines]);
  const append = (next: TermLine[], clear = false) => setLines((current) => (clear ? next : [...current, ...next]).slice(-MAX_LINES));
  const run = (command: string) => {
    const result = shell.run(command);
    append(result.lines, result.clear);
    setPrompt(shell.prompt());
    onTitle(shell.title());
    result.open.forEach((id, index) => window.setTimeout(() => onOpen(id, input.current), 350 + index * 120));
    if (result.exit) window.setTimeout(onClose, 150);
  };
  const echo = (text: string): TermLine => ({ kind: "echo", text, prompt: shell.prompt() });
  const render = (line: TermLine, index: number): ReactNode => (
    <div key={index} className={`is-${line.kind}`}>
      {line.kind === "echo" && line.prompt && (
        <>
          <Prompt text={line.prompt} />{" "}
        </>
      )}
      <TermText text={line.text} />
    </div>
  );
  return (
    <div className="pt-term" onPointerDown={() => window.setTimeout(() => !window.getSelection()?.toString() && input.current?.focus(), 0)}>
      <div className="pt-term-out" ref={out} aria-live="polite">
        {lines.map(render)}
      </div>
      <label className="pt-term-in">
        <Prompt text={prompt} />
        <input
          ref={input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="终端输入"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            const key = event.key;
            const ctrl = event.ctrlKey && !event.metaKey;
            if (key === "Enter") {
              cursor.current = null;
              run(value);
              setValue("");
            } else if (key === "Tab") {
              event.preventDefault();
              const result = shell.complete(value);
              setValue(result.line);
              if (result.options.length) append([echo(value), { kind: "out", text: result.options.join("  ") }]);
            } else if (key === "ArrowUp" || key === "ArrowDown") {
              event.preventDefault();
              const history = shell.history();
              const at = cursor.current ?? history.length;
              const next = key === "ArrowUp" ? Math.max(0, at - 1) : Math.min(history.length, at + 1);
              cursor.current = next;
              setValue(history[next] ?? "");
            } else if (ctrl && key.toLowerCase() === "c") {
              if (window.getSelection()?.toString()) return;
              event.preventDefault();
              append([{ ...echo(value), text: `${value}^C` }]);
              setValue("");
              cursor.current = null;
            } else if (ctrl && key.toLowerCase() === "l") {
              event.preventDefault();
              setLines([]);
            } else if (ctrl && key.toLowerCase() === "u") {
              event.preventDefault();
              setValue("");
            }
            if (!((event.metaKey || event.ctrlKey) && key.toLowerCase() === "k") && key !== "Escape") event.stopPropagation();
          }}
        />
      </label>
      <p className="pt-sr">模拟的 Linux 终端，输入 help 查看命令，可以打开的应用：{apps.map((app) => app.id).join("、")}</p>
    </div>
  );
}
