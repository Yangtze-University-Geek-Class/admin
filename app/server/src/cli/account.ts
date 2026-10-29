import { loadConfig } from "../config.js";
import { createDatabase } from "../lib/db.js";
import { createIdentityStore } from "../lib/identity-store.js";
import { createInviteCodeStore, InviteCodeError } from "../lib/invite-codes.js";
import { createLimits } from "../lib/limits.js";
import { normalizeEmail } from "../lib/email-login.js";

/**
 * 维护者在服务器上用的账号工具（#262，所有者 2026-10-23）。只开数据库，不起服务、不发信、不调用 GitHub；
 * 在运行中的容器里执行，和服务共用同一个库（WAL，可以同时写）：
 *
 *   docker exec <server 容器> node app/server/dist/cli/account.js provision --github-id 130495739 --github-login Crosery --org-role admin --email you@example.com
 *     按 GitHub 数字 id 找到或建立账号，记下组织角色，绑定邮箱（之后用邮箱验证码登录，再在账号页设密码）。可以重跑。
 *   docker exec -i <server 容器> node app/server/dist/cli/account.js invite --note 默认邀请码 < 邀请码文件
 *     新建一个注册邀请码，邀请码从标准输入读，不出现在命令行和进程列表里。
 *
 * 只输出账号 id 和做了什么，不输出邮箱、邀请码和任何密钥。
 */
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const config = loadConfig();
  const storage = createDatabase(config.dbPath);
  try {
    if (command === "provision") {
      const githubId = Number(option(args, "github-id"));
      const githubLogin = option(args, "github-login") ?? "";
      const orgRole = option(args, "org-role");
      const email = normalizeEmail(option(args, "email"));
      if (!Number.isSafeInteger(githubId) || githubId <= 0 || !githubLogin || (orgRole !== "admin" && orgRole !== "member") || !email) {
        process.stderr.write("usage: account.js provision --github-id <数字> --github-login <登录名> --org-role admin|member --email <邮箱>\n");
        return 2;
      }
      const identity = createIdentityStore(storage.db, {
        createSession: () => { throw new Error("provision never creates sessions"); },
        // provisionAccount 不走注册限额/邀请码猜测锁定那几条路径，这里的 limits 只是满足类型，不会被真的调用。
        audit: storage.audit, limits: createLimits(storage.db),
      });
      const result = identity.provisionAccount({ githubId, githubLogin, orgRole, email });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "provision-github") {
      const githubId = Number(option(args, "github-id"));
      const githubLogin = option(args, "github-login") ?? "";
      const orgRole = option(args, "org-role");
      if (!Number.isSafeInteger(githubId) || githubId <= 0 || !githubLogin || (orgRole !== "admin" && orgRole !== "member")) {
        process.stderr.write("usage: account.js provision-github --github-id <数字> --github-login <登录名> --org-role admin|member\n");
        return 2;
      }
      const identity = createIdentityStore(storage.db, {
        createSession: () => { throw new Error("provision-github never creates sessions"); },
        audit: storage.audit, limits: createLimits(storage.db),
      });
      const result = identity.provisionAccount({ githubId, githubLogin, orgRole });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "invite") {
      const code = await readStdin();
      try {
        const invite = createInviteCodeStore(storage.db).create({ code, note: option(args, "note") ?? "" }, "system");
        storage.audit("system", "invite.create", undefined, { id: invite.id, via: "cli" }, undefined, { surface: "system" });
        process.stdout.write(`${JSON.stringify({ id: invite.id, created: true })}\n`);
        return 0;
      } catch (error) {
        if (error instanceof InviteCodeError) {
          process.stderr.write(`${error.code}\n`);
          return error.code === "invite_code_taken" ? 0 : 2;
        }
        throw error;
      }
    }
    process.stderr.write("usage: account.js provision|invite …\n");
    return 2;
  } finally {
    storage.db.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
