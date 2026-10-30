// 桌面终端的模拟 Linux（#279）：文件系统、管道与重定向、变量、通配符、脚本与 PATH、权限、存盘、补全、打开桌面应用。
// 用例按 Linux 启明道场（linux.yangtzeu.work）的关卡顺序排，每一关教的命令在这里都要能敲。
import { describe, expect, it } from "vitest";
import type { Account } from "../../app/web/sites/portal/lib/account";
import { OS_APPS, visibleApps } from "../../app/web/sites/portal/lib/osApps";
import { createShell, type Shell } from "../../app/web/sites/portal/lib/shell";
import { plain, toSpans } from "../../app/web/sites/portal/lib/shell/ansi";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
};

const account = (over: Partial<Account> = {}): Account => ({
  login: "lyx",
  avatarUrl: null,
  consoleLink: false,
  accountId: "acc_1",
  username: "lyx",
  displayName: "林同学",
  bio: "",
  level: "member",
  levelName: "极客班成员",
  gradeLabel: "大二",
  department: { id: "ai", name: "AI部门", tone: "u" },
  titles: [{ id: "title.ai.member", name: "部员" }],
  permissions: [],
  quota: null,
  prefs: { startNoteSeenAt: null },
  identities: { emails: [], google: false, github: null },
  ...over,
});

function make(options: { account?: Account | null; storage?: ReturnType<typeof memory> } = {}): Shell {
  return createShell({ account: options.account ?? null, apps: visibleApps(false), storage: options.storage ?? memory() });
}

/** 跑一行，回标准输出和错误（去掉颜色码），不含回显那一行 */
function sh(shell: Shell, line: string) {
  const result = shell.run(line);
  const body = result.lines.filter((entry) => entry.kind !== "echo");
  return {
    out: body.filter((entry) => entry.kind === "out").map((entry) => plain(entry.text)).join("\n"),
    err: body.filter((entry) => entry.kind === "err").map((entry) => plain(entry.text)).join("\n"),
    result,
  };
}

describe("你好，黑客 / 探索路径", () => {
  it("没登录是 guest，家目录 /home/guest，提示符和窗口标题跟着目录走", () => {
    const shell = make();
    expect(shell.prompt()).toBe("guest@yugc:~$");
    expect(sh(shell, "whoami").out).toBe("guest");
    expect(sh(shell, "pwd").out).toBe("/home/guest");
    sh(shell, "cd Desktop");
    expect(shell.prompt()).toBe("guest@yugc:~/Desktop$");
    expect(shell.title()).toBe("guest@yugc: ~/Desktop");
    sh(shell, "cd ..");
    sh(shell, "cd /var/log");
    expect(sh(shell, "pwd").out).toBe("/var/log");
    expect(sh(shell, "cd -").out).toBe("/home/guest");
    expect(sh(shell, "cd ~/nope").err).toBe("bash: cd: /home/guest/nope: No such file or directory");
    expect(sh(shell, "echo hello   world").out).toBe("hello world");
  });

  it("登录后用极客班用户名，id 里有身份和部门两个组，neofetch 写身份、部门、称号", () => {
    const shell = make({ account: account() });
    expect(shell.prompt()).toBe("lyx@yugc:~$");
    expect(sh(shell, "id").out).toBe("uid=1000(lyx) gid=1000(lyx) groups=1000(lyx),1001(members),1100(ai)");
    const fetch = sh(shell, "neofetch").out;
    expect(fetch).toContain("身份: 极客班成员");
    expect(fetch).toContain("部门: AI部门");
    expect(fetch).toContain("称号: 部员");
  });

  it("用户名不像 Linux 用户名时退回 guest", () => {
    expect(make({ account: account({ username: "../root" }) }).user).toBe("guest");
  });
});

describe("理解命令", () => {
  it("ls 默认不列隐藏文件，-a 才列；桌面应用在 ~/Desktop 里，跟着 console_link 过滤", () => {
    const shell = make();
    expect(sh(shell, "ls").out).toBe("Desktop  Documents  README.md  join  projects");
    expect(sh(shell, "ls -a").out).toContain(".bashrc");
    const desktop = sh(shell, "ls ~/Desktop").out.split("  ");
    expect(desktop).toContain("forum.app");
    expect(desktop).not.toContain("console.app");
    const admin = createShell({ account: account({ consoleLink: true }), apps: visibleApps(true), storage: memory() });
    expect(sh(admin, "ls ~/Desktop").out).toContain("console.app");
  });

  it("mkdir -p、touch、cp、mv、rm，报错照 coreutils 的格式", () => {
    const shell = make();
    sh(shell, "mkdir -p notes/2026 && touch notes/a.txt");
    expect(sh(shell, "ls notes").out).toBe("2026  a.txt");
    expect(sh(shell, "mkdir notes").err).toBe("mkdir: cannot create directory 'notes': File exists");
    sh(shell, "cp notes/a.txt notes/b.txt && mv notes/b.txt notes/2026/");
    expect(sh(shell, "ls notes/2026").out).toBe("b.txt");
    expect(sh(shell, "rm notes").err).toBe("rm: cannot remove 'notes': Is a directory");
    expect(sh(shell, "cp notes backup").err).toBe("cp: -r not specified; omitting directory 'notes'");
    sh(shell, "rm -r notes");
    expect(sh(shell, "ls notes").err).toBe("ls: cannot access 'notes': No such file or directory");
    expect(sh(shell, "rm -rf /").err).toContain("it is dangerous to operate recursively on '/'");
  });

  it("ls -l 写权限、所有者和大小；系统文件归 root", () => {
    const shell = make();
    expect(sh(shell, "ls -l /etc/hostname").out).toMatch(/^-rw-r--r-- 1 root\s+root\s+5 \w{3}\s+\d+ \d\d:\d\d \/etc\/hostname$/);
    expect(sh(shell, "ls -ld ~").out).toMatch(/^drwxr-x--- 1 guest\s+guest\s+4096 .* \/home\/guest$/);
  });
});

describe("研读文档", () => {
  it("man 和 --help 给用法，help 列出命令和 Linux 启明道场的地址", () => {
    const shell = make();
    expect(sh(shell, "man ls").out).toContain("用法：ls [-alAh1dFR] [路径...]");
    expect(sh(shell, "grep --help").out).toContain("-v");
    expect(sh(shell, "man nope").err).toBe("No manual entry for nope");
    const help = sh(shell, "help").out;
    expect(help).toContain("https://linux.yangtzeu.work");
    expect(help).not.toMatch(/\bvim\b/);
    expect(sh(shell, "learn").out).toContain("管道与重定向");
  });
});

describe("文件通配符", () => {
  it("* ? [ ] 匹配文件，引号里不展开，没有匹配时原样传下去", () => {
    const shell = make();
    sh(shell, "mkdir w && cd w && touch a1.md a2.md b.txt .hidden");
    expect(sh(shell, "echo *.md").out).toBe("a1.md a2.md");
    expect(sh(shell, "echo a?.md").out).toBe("a1.md a2.md");
    expect(sh(shell, "echo [ab]*").out).toBe("a1.md a2.md b.txt");
    expect(sh(shell, 'echo "*.md"').out).toBe("*.md");
    expect(sh(shell, "echo *.zip").out).toBe("*.zip");
    expect(sh(shell, "echo *").out).not.toContain(".hidden");
    expect(sh(shell, "echo ~/Desktop/fo*.app").out).toBe("/home/guest/Desktop/forum.app");
  });
});

describe("管道与重定向", () => {
  it("> 覆盖、>> 追加、< 读入、| 接管道、2> 和 2>&1 分开错误", () => {
    const shell = make();
    sh(shell, "echo one > f.txt && echo two >> f.txt");
    expect(sh(shell, "cat f.txt").out).toBe("one\ntwo");
    expect(sh(shell, "wc -l < f.txt").out).toBe("2");
    expect(sh(shell, "cat f.txt | grep tw").out).toBe("two");
    expect(sh(shell, "ls nope 2> err.txt").err).toBe("");
    expect(sh(shell, "cat err.txt").out).toBe("ls: cannot access 'nope': No such file or directory");
    sh(shell, "ls nope f.txt > both.txt 2>&1");
    expect(sh(shell, "cat both.txt").out).toBe("f.txt\nls: cannot access 'nope': No such file or directory");
    expect(sh(shell, "ls nope 2>&1 | wc -l").out).toBe("1");
    expect(sh(shell, "echo hi | tee t.txt | tr a-z A-Z").out).toBe("HI");
    expect(sh(shell, "cat t.txt").out).toBe("hi");
  });

  it("接管道或重定向时 ls 不上色、一行一个，直接显示时上色", () => {
    const shell = make();
    expect(sh(shell, "ls | head -n 2").out).toBe("Desktop\nDocuments");
    const colored = shell.run("ls").lines[1].text;
    expect(colored).toContain("\x1b[1;34mDesktop\x1b[0m");
  });

  it("系统目录只读：写进去报 Permission denied，/root 和 /etc/shadow 读不了", () => {
    const shell = make();
    expect(sh(shell, "echo x > /etc/hostname").err).toBe("bash: /etc/hostname: Permission denied");
    expect(sh(shell, "touch /usr/bin/x").err).toBe("touch: cannot touch '/usr/bin/x': Permission denied");
    expect(sh(shell, "ls /root").err).toBe("ls: cannot open directory '/root': Permission denied");
    expect(sh(shell, "cat /etc/shadow").err).toBe("cat: /etc/shadow: Permission denied");
    expect(sh(shell, "echo ok > /tmp/x && cat /tmp/x").out).toBe("ok");
  });
});

describe("Shell 变量", () => {
  it("赋值、export、$?、$((…))、$(…)、单双引号", () => {
    const shell = make();
    sh(shell, "name=极客班");
    expect(sh(shell, 'echo "hi $name"').out).toBe("hi 极客班");
    expect(sh(shell, "echo 'hi $name'").out).toBe("hi $name");
    expect(sh(shell, "env | grep name").out).toBe("");
    sh(shell, "export name");
    expect(sh(shell, "env | grep ^name=").out).toBe("name=极客班");
    sh(shell, "false");
    expect(sh(shell, "echo $?").out).toBe("1");
    expect(sh(shell, "echo $((3 * (4 + 1)))").out).toBe("15");
    expect(sh(shell, "echo $((2 ** 3 ** 2)) $((-2 ** 2)) $((-7 / 2)) $((-7 % 2))").out).toBe("512 4 -3 -1");
    expect(sh(shell, "echo $((2 ** 63)) $((2 ** 64)) $((9223372036854775807 + 1))").out).toBe("-9223372036854775808 0 -9223372036854775808");
    const broken = sh(shell, "echo $((2 +)) && echo 没跑");
    expect(broken).toMatchObject({ out: "", err: "bash: 2 +: syntax error in expression" });
    expect(sh(shell, "echo $?").out).toBe("1");
    expect(sh(shell, "for i in 1 2; do echo $i; done")).toMatchObject({ out: "", err: expect.stringContaining("bash: for: 这个终端不支持") });
    expect(sh(shell, "for i in 1 2; do echo $i; done").err.split("\n")).toHaveLength(1);
    expect(sh(shell, 'echo "我在 $(pwd)"').out).toBe("我在 /home/guest");
    expect(sh(shell, "echo $(cd /tmp; pwd) $PWD").out).toBe("/tmp /home/guest");
    expect(sh(shell, "GREETING=yo env | grep GREETING").out).toBe("GREETING=yo");
    expect(sh(shell, "echo [$GREETING]").out).toBe("[]");
    expect(sh(shell, 'echo "a').err).toContain("unexpected EOF");
  });
});

describe("数据处理", () => {
  it("grep、sort、uniq -c、cut、wc、head、tail、sed 处理日志", () => {
    const shell = make();
    expect(sh(shell, "grep -c open /var/log/yugc.log").out).toBe("6");
    expect(sh(shell, "grep 'window: open' /var/log/yugc.log | cut -d' ' -f5 | sort | head -n 2").out).toBe("about\ncompetitions");
    expect(sh(shell, "cut -d' ' -f3 /var/log/yugc.log | sort | uniq -c | sort -rn | head -n 1").out).toBe("      8 window:");
    expect(sh(shell, "tail -n 1 /var/log/yugc.log").out).toContain("close competitions");
    expect(sh(shell, "echo 2025 | sed 's/5/6/'").out).toBe("2026");
    expect(sh(shell, "cut -d: -f1 /etc/passwd").out).toBe("root\nguest");
    expect(sh(shell, "seq 3 | tac | xargs echo").out).toBe("3 2 1");
    expect(sh(shell, "grep -n kernel /var/log/yugc.log").out).toMatch(/^1:/);
  });
});

describe("命令串联与脚本 / 深入 PATH", () => {
  it("&& 和 || 看上一条的结果，; 不管结果", () => {
    const shell = make();
    expect(sh(shell, "false && echo a || echo b").out).toBe("b");
    expect(sh(shell, "true && echo a; echo c").out).toBe("a\nc");
    expect(sh(shell, "test -d ~/Desktop && echo 有").out).toBe("有");
    expect(sh(shell, "[ 3 -gt 5 ] || echo 小").out).toBe("小");
  });

  it("脚本要 chmod +x 才能 ./ 运行，参数是 $1 和 $#，子 shell 里 cd 不影响外面，source 会", () => {
    const shell = make();
    sh(shell, "echo 'cd /tmp' > go.sh && echo 'echo hi $1 $#' >> go.sh");
    expect(sh(shell, "./go.sh").err).toBe("bash: ./go.sh: Permission denied");
    sh(shell, "chmod +x go.sh");
    expect(sh(shell, "./go.sh 同学").out).toBe("hi 同学 1");
    expect(sh(shell, "pwd").out).toBe("/home/guest");
    sh(shell, "source go.sh");
    expect(sh(shell, "pwd").out).toBe("/tmp");
  });

  it("which 在 PATH 里找；自己的脚本放进 ~/bin 加进 PATH 就能直接敲名字；PATH 清空后外部命令找不到", () => {
    const shell = make();
    expect(sh(shell, "which ls").out).toBe("/usr/bin/ls");
    expect(sh(shell, "type cd").out).toBe("cd is a shell builtin");
    expect(sh(shell, "type ll").out).toBe("ll is aliased to `ls -la'");
    sh(shell, "mkdir ~/bin && echo 'echo 你好' > ~/bin/hello && chmod +x ~/bin/hello");
    expect(sh(shell, "hello").err).toBe("bash: hello: command not found");
    sh(shell, "export PATH=$HOME/bin:$PATH");
    expect(sh(shell, "hello").out).toBe("你好");
    sh(shell, "PATH=");
    expect(sh(shell, "ls").err).toBe("bash: ls: command not found");
    expect(sh(shell, "echo builtin").out).toBe("builtin");
  });

  it("用户与身份：sudo 不在 sudoers 里，kill $$ 关掉终端", () => {
    const shell = make();
    expect(sh(shell, "sudo ls").err).toContain("guest is not in the sudoers file.");
    expect(shell.run("kill $$").exit).toBe(true);
    expect(sh(shell, "kill 1").err).toBe("bash: kill: (1) - Operation not permitted");
  });
});

describe("桌面", () => {
  it("open 应用、运行 .app、./join、直接敲应用名都打开窗口；看不到的应用打不开；PATH 里没有 /usr/local/bin 时敲应用名提示 open", () => {
    const shell = make();
    expect(shell.run("open forum").open).toEqual(["forum"]);
    expect(shell.run("./Desktop/competitions.app").open).toEqual(["competitions"]);
    expect(shell.run("./join").open).toEqual(["join"]);
    expect(shell.run("cd Desktop && ./gitlab.app").open).toEqual(["gitlab"]);
    const hidden = shell.run("open console");
    expect(hidden.open).toEqual([]);
    expect(hidden.lines.at(-1)?.kind).toBe("err");
    expect(shell.run("forum").open).toEqual(["forum"]);
    expect(shell.run("join").open).toEqual(["join"]);
    expect(sh(shell, "which forum").out).toBe("/usr/local/bin/forum");
    expect(shell.run("console").open).toEqual([]);
    expect(sh(shell, "PATH=/usr/bin forum").err).toBe("bash: forum: command not found\n要打开「论坛」，输入 open forum");
    expect(OS_APPS.find((app) => app.id === "console")).toBeTruthy();
  });

  it("repos 和 ~/projects 随可访问项目更新，撤掉列表后移除旧项目", () => {
    const shell = make();
    shell.setRepos([{ name: "admin", path: "geek/admin", description: "官网和后端", url: "https://example.test/gitlab/geek/admin", cloneUrl: "https://example.test/gitlab/geek/admin.git", activeAt: null }]);
    expect(sh(shell, "repos").out).toContain("geek/admin");
    expect(sh(shell, "cat ~/projects/admin/README.md").out).toContain("https://example.test/gitlab/geek/admin");
    shell.setRepos([]);
    expect(sh(shell, "ls ~/projects").out).toBe("");
    expect(sh(shell, "cat ~/projects/admin/README.md").err).toContain("No such file");
  });

  it("clear 清屏，exit 关窗口，!! 重复上一条", () => {
    const shell = make();
    expect(shell.run("echo a; clear; echo b")).toMatchObject({ clear: true, lines: [{ kind: "out", text: "b" }] });
    expect(shell.run("exit").exit).toBe(true);
    sh(shell, "echo again");
    expect(sh(shell, "!!").out).toBe("echo again\nagain");
  });
});

describe("存盘与补全", () => {
  it("家目录里自己写的文件、改过的 .bashrc 和历史按用户名存进 localStorage，下次打开还在；生成的应用不存", () => {
    const storage = memory();
    const first = make({ storage });
    sh(first, "mkdir notes && echo 记一笔 > notes/todo.txt && chmod 600 notes/todo.txt");
    sh(first, "echo \"alias hi='echo 你好'\" >> ~/.bashrc");
    sh(first, "rm ~/Desktop/forum.app");
    const saved = JSON.parse(storage.data.get("yugc:term:guest")!) as { entries: Array<[string]> };
    expect(saved.entries.map(([path]) => path)).toEqual([".bash_history", ".bashrc", "notes", "notes/todo.txt"]);
    const second = make({ storage });
    expect(sh(second, "cat notes/todo.txt").out).toBe("记一笔");
    expect(sh(second, "ls -l notes/todo.txt").out).toMatch(/^-rw-------/);
    expect(sh(second, "hi").out).toBe("你好");
    expect(sh(second, "ls ~/Desktop").out).toContain("forum.app");
    expect(second.history()).toContain("mkdir notes && echo 记一笔 > notes/todo.txt && chmod 600 notes/todo.txt");
    expect(make({ account: account(), storage }).run("ls notes").lines.at(-1)?.kind).toBe("err");
  });

  it("同名不同账号、退出和身份降级都不能载入旧成员的文件与命令历史；同一账号改名仍可续用", () => {
    const storage = memory();
    const first = make({ account: account(), storage });
    sh(first, "echo private-note > secret.txt");
    const another = make({ account: account({ accountId: "acc_2" }), storage });
    expect(sh(another, "cat secret.txt").err).toContain("No such file");
    expect(another.history()).not.toContain("echo private-note > secret.txt");
    const visitor = make({ storage });
    expect(sh(visitor, "cat secret.txt").err).toContain("No such file");
    const registered = make({ account: account({ level: "registered" }), storage });
    expect(sh(registered, "cat secret.txt").err).toContain("No such file");
    expect(registered.history()).not.toContain("echo private-note > secret.txt");
    const renamed = make({ account: account({ username: "renamed" }), storage });
    expect(sh(renamed, "cat secret.txt").out).toBe("private-note");
    expect(renamed.history()).toContain("echo private-note > secret.txt");
  });

  it("家目录写满报 No space left on device", () => {
    const shell = make();
    sh(shell, "seq 30000 > big.txt");
    expect(sh(shell, "cat big.txt big.txt big.txt big.txt > bigger.txt").err).toBe("bash: bigger.txt: No space left on device");
  });

  it("Tab 补全命令名和路径，多个候选时列出来", () => {
    const shell = make();
    expect(shell.complete("neof")).toEqual({ line: "neofetch ", options: [] });
    expect(shell.complete("cat REA")).toEqual({ line: "cat README.md ", options: [] });
    expect(shell.complete("cd Des")).toEqual({ line: "cd Desktop/", options: [] });
    expect(shell.complete("ls D").options).toEqual(["Desktop/", "Documents/"]);
    expect(shell.complete("cat Desktop/for")).toEqual({ line: "cat Desktop/forum.app ", options: [] });
    sh(shell, "pwd");
    expect(shell.complete("ls ~/.bas")).toEqual({ line: "ls ~/.bash", options: [] });
    expect(shell.complete("ls ~/.bash")).toEqual({ line: "ls ~/.bash", options: [".bash_history", ".bashrc"] });
  });
});

describe("颜色码", () => {
  it("切成带颜色的片段，https 地址变链接，plain 去掉颜色码", () => {
    expect(toSpans("\x1b[1;34mDesktop\x1b[0m  a")).toEqual([
      { text: "Desktop", bold: true, color: 34 },
      { text: "  a", bold: false, color: undefined },
    ]);
    expect(toSpans("见 https://linux.yangtzeu.work 吧").map((span) => span.href)).toEqual([undefined, "https://linux.yangtzeu.work", undefined]);
    expect(plain("\x1b[92mY\x1b[0m")).toBe("Y");
  });
});
