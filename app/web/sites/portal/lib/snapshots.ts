// 论坛最新话题与公开仓库的静态快照（public/portal/*.json）。不是实时数据：界面上必须写「快照 <日期>」。
// 论坛的实时接口只在本机开发时存在，生产官网拿不到，所以这里只读随构建发布的快照文件。
import { useEffect, useState } from "react";
import type { RepoSnapshot } from "./osApps";

/**
 * 快照只收录已在仓库里公开编辑过的话题（app/forum/content/curation.json 的 topics），
 * 不带作者：论坛私有投影里的用户名与真实姓名不进公开官网包。id 就是论坛话题路由 /t/<id>。
 */
export type ForumTopic = {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  color: string;
  replies: number;
  views: number;
  at: number;
};

export type ForumCategory = { slug: string; name: string; color: string; count: number };

export type ForumSnapshot = {
  summary: { capturedAt: string; topics: number; posts: number; users: number; categories: ForumCategory[] };
  latest: ForumTopic[];
};

export type RepoList = { capturedAt: string; org: string; repos: RepoSnapshot[] };

export type Snapshot<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let pending = cache.get(url) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(url, { headers: { Accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<T>;
    });
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

function useSnapshot<T>(url: string): Snapshot<T> {
  const [state, setState] = useState<Snapshot<T>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    load<T>(url).then(
      (data) => alive && setState({ status: "ready", data }),
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

export const FORUM_SNAPSHOT_URL = "/portal/forum-latest.json";
export const REPOS_SNAPSHOT_URL = "/portal/repos.json";

export const useForumSnapshot = () => useSnapshot<ForumSnapshot>(FORUM_SNAPSHOT_URL);
export const useRepoSnapshot = () => useSnapshot<RepoList>(REPOS_SNAPSHOT_URL);
export const loadRepoSnapshot = () => load<RepoList>(REPOS_SNAPSHOT_URL);

/** 「快照 2026-09-12」：只取日期部分 */
export function snapshotLabel(capturedAt: string | undefined): string {
  return capturedAt ? `快照 ${capturedAt.slice(0, 10)}` : "快照";
}
