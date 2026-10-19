# Agent 根入口接入

> OMP 与 Claude 读取根 AGENTS.md 的本机加载证据、启动方式和验证边界；本页只说明接入，不定义第二套项目规则。

状态：`current` · 更新：2026-10-18 · 适用：本仓库及其 task worktree 的本机 OMP、Claude 启动与加载排查。

## 入口与约束

规则只在根 [AGENTS.md](../../AGENTS.md) 和它导航到的规范中维护。启动目录应为当前任务 worktree 根；载入后仍须按 [AGENT-START](AGENT-START.md) 先确认分支、完整读规范。不给不同 harness 新建 `CLAUDE.md` 等入口或跳转文件，也不为接入修改用户全局设置。

每次升级或切换二进制后重新核验。下面是本机已装版本的证据，不保证任意版本、用户设置、远程会话或恢复会话都使用相同行为；加载成功也不证明模型会遵守全部规则。

## 本机事实

2026-10-18 在 `task/257/architecture_catalog` 核对：

| 工具 | 已安装产物 | 实际加载路径 | 证据边界 |
|---|---|---|---|
| OMP 18.11.0 | `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`，`omp` 指向 `dist/cli.js` | 随包源码 `src/discovery/agents-md.ts:20` 的 `loadAgentsMd` 调用 `src/discovery/helpers.ts:721` 的 `loadStandaloneContextFiles` | 直接运行已装包的真实 loader，无会话或模型调用；未启动完整 CLI 的全部 provider 合并流程 |
| Claude Code 2.1.302 | `~/.bun/install/global/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude`，arm64 Mach-O；`claude --version` 输出 `2.1.302 (Claude Code)` | 内置 `cc-plugin-agents-md` 的 `prompt.context` hook；另有显式 `--append-system-prompt-file` 读取分支 | 从本机二进制提取实际 hook，在隔离宿主中运行；文件适配器只读本 task 根文件，未启动完整 Claude 会话、读取账号凭据或调用模型 |

本次根 AGENTS 内容为 14255 字节，SHA-256 为 `260b61663e61c24043241ac2fd5130dbc30559f52a7bd1ea930b6b5b89b58cfc`；两个 loader 的结果都与该根文件逐字相等。这是此次核验的快照，后续改文档应重新计算，不能拿此摘要证明新内容已加载。

OMP 返回三个项目上下文路径：当前 task 根（depth 0）、主工作区根（depth 3）和上级 `work_file/AGENTS.md`（depth 4），warnings 为空。源码明确允许向 Git 根之外继续扫描到 home 之前；所以“在 worktree 启动”不等于“只读这一份 AGENTS”。本次只报告发现结果，不修改祖先文件或推断全部 provider 的最终优先级。

Claude 二进制 SHA-256 为 `5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37`。其中两个以 `// @bun @bytecode` 开头、NUL 结尾的嵌入模块，字节区间分别是 `[249666706,249670007)` 与 `[249670008,249683258)`。前者定义 AGENTS 文件名及模式，后者注册实际加载 hook。隔离执行结果：

- 默认 `claude-md-or-agents-md`：当前根没有 CLAUDE 文件时加载根 AGENTS。
- `claude-md`：不加载 AGENTS。
- `claude-md-and-agents-md`：加载根 AGENTS。

默认模式还检查项目路径上的 CLAUDE 文件；实际是否启用插件受功能开关和会话选项影响。这里没有探测用户全局开关，不能凭默认值保证完整会话已加载。显式文件注入分支会读取指定路径的字节，转换为 UTF-8 后合入追加提示；Remote Control 另有载体摘要约束，本页启动命令仅针对本地新会话。

## 启动方式

在目标 worktree 根执行 `omp`，由内置 AGENTS provider 自动发现。需要明确指定根规则给本地 Claude 新会话时：

```bash
claude --append-system-prompt-file "$(git rev-parse --show-toplevel)/AGENTS.md"
```

该命令不写全局配置、不增加规则文件。它是实际工作时的启动入口；本次只核验参数读取分支和 loader，没有执行这条启动命令。首次进入后仍按根入口阅读其导航的全部适用规范；普通 Markdown 链接不等于文件内容已全部注入。

## 可复查的无模型验证

从目标 worktree 根运行。以下命令不创建会话，也不打印规则正文或凭据。

OMP：直接调用本次已装包的 provider。路径随安装位置变化时，先用 `command -v omp` 和符号链接确认包根，不能把旧路径当现行版本。

```bash
bun --eval '
import { loadAgentsMd } from "/Users/crosery/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/discovery/agents-md.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
const cwd = process.cwd();
const result = await loadAgentsMd({ cwd, home: homedir(), repoRoot: cwd });
const root = result.items.find(item => item.path === cwd + "/AGENTS.md");
if (!root || root.content !== readFileSync(cwd + "/AGENTS.md", "utf8")) throw new Error("根入口缺失或内容不符");
console.log(JSON.stringify({
  paths: result.items.map(({ path, depth }) => ({ path, depth })),
  rootBytes: Buffer.byteLength(root.content),
  sha256: createHash("sha256").update(root.content).digest("hex"),
  warnings: result.warnings,
}, null, 2));
'
```

Claude：以下只在 SHA 匹配时，从已核验产物提取两个模块执行。移除模块导入，给真实 hook 提供本 task 文件读取适配器；未复现完整引擎的祖先遍历、导入展开或远端功能开关。它证明实际 hook 在这组明确输入下输出了根文件，不是完整 CLI 的请求抓包。

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const bytes = fs.readFileSync("/Users/crosery/.bun/install/global/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude");
assert.equal(createHash("sha256").update(bytes).digest("hex"), "5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37");
const source = (start, end) => bytes.subarray(start, end).toString()
  .replace(/import(?:[^;]*?from)?"\/\$bunfs\/[^"\n]+";/g, "")
  .replace(/export\{[^}]*\};/g, "")
  .replaceAll("import.meta.dir", '"/isolated"');
const base = vm.createContext({ ir: (_key, fallback) => fallback });
vm.runInContext(source(249666706, 249670007), base);
const names = bytes.subarray(249666706, 249670007).toString().match(/export\{([^}]+)\};/)[1].split(",");
const bindings = Object.fromEntries(names.map(name => [name, vm.runInContext(name, base)]));
const context = vm.createContext({
  ...bindings,
  A: fn => { const module = { exports: {} }; fn(module.exports, module); return () => module.exports; },
  Mr: (target, getters) => Object.keys(getters).forEach(key => Object.defineProperty(target, key, { get: getters[key] })),
});
vm.runInContext(source(249670008, 249683258), context);
const register = vm.runInContext("Oe", context), cwd = process.cwd();
const expected = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
const host = {
  session: { root: async () => cwd, cwd: async () => cwd },
  fs: { ancestors: async ({ names }) => names.flatMap(name => {
    const file = path.join(cwd, name);
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? [{ dir: cwd, parts: [{ path: file, content: fs.readFileSync(file, "utf8") }] }] : [];
  }) },
  telemetry: { log() {}, mark() {} }, ui: { log() {} },
};
for (const mode of [undefined, "claude-md", "claude-md-and-agents-md"]) {
  const hooks = new Map();
  register((name, ...args) => hooks.set(name, args.at(-1)), mode ? { instructionFiles: mode } : {});
  const input = { instructionFiles: [] };
  const output = hooks.has("prompt.context")
    ? await hooks.get("prompt.context")(host, input, async value => value) : input;
  const root = output.instructionFiles.find(item => item.path === path.join(cwd, "AGENTS.md"));
  assert.equal(Boolean(root), mode !== "claude-md");
  if (root) assert.equal(root.content, expected);
  console.log(JSON.stringify({ mode: mode ?? "default", rootLoaded: Boolean(root) }));
}
NODE
```

预期三个输出的 `rootLoaded` 为 `true / false / true`。若当前根新增 CLAUDE 文件、安装版本不符或断言失败，保留实际错误并重新核查 loader；不要修改断言或新增第二入口来制造成功。CLI 的完整启动、最终请求上下文与模型遵守情况仍须在获准的真实会话中单独验证。
