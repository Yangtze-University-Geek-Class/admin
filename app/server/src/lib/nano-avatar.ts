import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * NANO 默认头像（#343）：没上传头像、GitHub 也只有自动生成的像素图时用。8 张图和 GitLab 前置用的是同一份文件
 * （deploy/gitlab/ui/nano-avatars/<版本>/，server 镜像按原路径带上），挑哪一张也是同一条规则：标识去掉首尾空白、
 * 转小写后取 SHA-256，第一位十六进制模 8，0 和 8 是第 1 张……7 和 f 是第 8 张（deploy/remote/edge-gitlab.py 生成的 gitlab_nano_avatar 映射）。
 * GitLab 的头像服务按用户的主邮箱（没有时用户名）算，站内传进来的标识是 GitLab 那边用的同一个地址（lib/gitlab-sync.ts 的
 * gitlabAvatarIdentifier），所以同一个人在两边是同一张。
 */
export const NANO_AVATAR_VERSION = "20261025";
export const NANO_AVATAR_COUNT = 8;

/** 1–8 号默认头像的地址；带版本号，换一套图时地址跟着变，浏览器的长期缓存不会拿到旧图。 */
export const nanoAvatarPath = (index: number) => `/api/identity/default-avatar/${NANO_AVATAR_VERSION}/${index}.png`;

export function nanoAvatarIndex(identifier: string): number {
  const digest = createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
  return (Number.parseInt(digest[0]!, 16) % NANO_AVATAR_COUNT) + 1;
}

/**
 * 读 8 张图并按 manifest.json 核对字节（sha256）；缺文件、清单不对或字节对不上都抛错，让启动失败，
 * 不带着一半默认头像上线。返回按编号（1–8）取图的函数。
 */
export function loadNanoAvatars(dir: string): (index: number) => Buffer | null {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version?: unknown; avatars?: { id?: unknown; file?: unknown; sha256?: unknown }[] };
  if (manifest.version !== NANO_AVATAR_VERSION || !Array.isArray(manifest.avatars) || manifest.avatars.length !== NANO_AVATAR_COUNT) {
    throw new Error(`nano avatars: ${dir}/manifest.json is not version ${NANO_AVATAR_VERSION} with ${NANO_AVATAR_COUNT} avatars`);
  }
  const files = manifest.avatars.map((entry, offset) => {
    const id = `avatar-${String(offset + 1).padStart(2, "0")}`;
    if (entry.id !== id || entry.file !== `${id}.png` || typeof entry.sha256 !== "string") throw new Error(`nano avatars: manifest entry ${offset + 1} is not ${id}.png`);
    const data = readFileSync(join(dir, entry.file));
    if (createHash("sha256").update(data).digest("hex") !== entry.sha256) throw new Error(`nano avatars: ${entry.file} does not match manifest.json`);
    return data;
  });
  return index => (Number.isInteger(index) && index >= 1 && index <= NANO_AVATAR_COUNT ? files[index - 1]! : null);
}
