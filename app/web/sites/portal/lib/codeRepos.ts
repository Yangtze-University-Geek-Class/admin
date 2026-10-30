// 访客读公开项目，有效极客班成员读成员项目；切换账号时不保留上一身份的列表。
import { useEffect, useState } from "react";
import { api } from "@shared/lib/api";
import { Account } from "./account";

export type CodeProject = { name: string; path: string; description: string; url: string; cloneUrl: string; activeAt: number | null };

export type CodeRepos = { status: "loading" } | { status: "ready"; projects: CodeProject[] } | { status: "unavailable" } | { status: "error" } | { status: "denied" };

export const CODE_REPOS_URL = "/api/public/gitlab/projects";
export const MEMBER_CODE_REPOS_URL = "/api/me/gitlab/projects";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const https = (value: unknown): string => (/^https?:\/\//.test(text(value)) ? text(value) : "");

/** 最近活动时间：GitLab 给的是 ISO 时间字符串，也认毫秒时间戳；读不出时为 null */
function readTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** 读接口响应：缺名字或地址的项目丢掉，按最近活动从新到旧排 */
export function readCodeRepos(body: unknown): CodeRepos {
  if (!isRecord(body) || !Array.isArray(body.projects)) return { status: "error" };
  if (body.unavailable === true) return { status: "unavailable" };
  const projects = body.projects.filter(isRecord).flatMap((item): CodeProject[] => {
    const name = text(item.name);
    const url = https(item.web_url);
    if (!name || !url) return [];
    return [{ name, path: text(item.path_with_namespace) || name, description: text(item.description), url, cloneUrl: https(item.http_url_to_repo), activeAt: readTime(item.last_activity_at) }];
  });
  return { status: "ready", projects: projects.sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0)) };
}

export function useCodeRepos(account: Account | null, enabled: boolean): CodeRepos {
  const member = account?.level === "member" || account?.level === "alumni";
  const accountId = account?.accountId ?? null;
  const scope = member ? `member:${accountId ?? ""}` : "public";
  const [result, setResult] = useState<{ scope: string; state: CodeRepos }>({ scope: "", state: { status: "loading" } });
  useEffect(() => {
    if (!enabled) return;
    if (member && !accountId) {
      setResult({ scope, state: { status: "denied" } });
      return;
    }
    const controller = new AbortController();
    setResult({ scope, state: { status: "loading" } });
    api<unknown>(member ? MEMBER_CODE_REPOS_URL : CODE_REPOS_URL, { signal: controller.signal, headers: { Accept: "application/json" } }).then(
      (body) => {
        if (!controller.signal.aborted) setResult({ scope, state: readCodeRepos(body) });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const denied = isRecord(error) && (error.status === 401 || error.status === 403);
        setResult({ scope, state: { status: denied ? "denied" : "error" } });
      },
    );
    return () => controller.abort();
  }, [enabled, scope, member, accountId]);
  return enabled && result.scope === scope ? result.state : { status: "loading" };
}
