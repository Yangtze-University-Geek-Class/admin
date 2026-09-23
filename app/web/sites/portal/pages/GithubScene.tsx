// GitHub 场景：贡献天际线（../three/github.ts，高度是示意）+ 左侧说明与公开仓库快照。
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import SceneBar from "../components/SceneBar";
import { links } from "../lib/links";
import { LEVEL_COLORS } from "../lib/skyline";
import { loadRepoSnapshot, snapshotLabel, type RepoList } from "../lib/snapshots";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { GithubHandle } from "../three/github";
import "../styles/portal.css";
import "../styles/scenes.css";

export default function GithubScene() {
  const reducedMotion = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<GithubHandle | null>(null);
  const [repos, setRepos] = useState<RepoList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: RepoList | null = null;
      try {
        list = await loadRepoSnapshot();
        if (!cancelled) setRepos(list);
      } catch {
        if (!cancelled) setFailed(true);
      }
      try {
        const module = await import("../three/github");
        if (cancelled || !canvas.current) return;
        const handle = await module.createGithubScene(canvas.current, {
          reducedMotion,
          repos: list?.repos ?? [],
          onLeft: () => window.open(links.githubOrg(), "_blank", "noopener"),
        });
        if (cancelled) handle.dispose();
        else scene.current = handle;
      } catch {
        /* 没有 WebGL：左侧信息照常可用 */
      }
    })();
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时建一次场景
  }, []);

  return (
    <div className="pt-root pt-scene pt-github">
      <canvas ref={canvas} className="pt-scene-canvas" aria-hidden="true" />
      <SceneBar crumb="github" />
      <section className="pt-intro pt-gh-intro" aria-labelledby="pt-gh-title">
        <h1 id="pt-gh-title">GitHub 组织</h1>
        <p>下面是极客班在 GitHub 组织里的公开仓库。点按钮去组织主页看更多。</p>
        <a
          className="pt-btn is-ink is-lg"
          href={links.githubOrg()}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (!scene.current) return;
            event.preventDefault();
            scene.current.leave();
          }}
        >
          <Icon name="github-line" size={18} /> 打开 GitHub 组织 <Icon name="external-link-line" size={15} />
        </a>
        <ul className="pt-gh-repos" aria-label="公开仓库">
          {failed && <li className="pt-empty">仓库列表没加载出来，点上面的按钮直接去 GitHub 看。</li>}
          {repos?.repos.map((repo) => (
            <li key={repo.name}>
              <a href={repo.url} target="_blank" rel="noreferrer">
                <Icon name="git-repository-line" size={15} />
                <b>{repo.name}</b>
                <span>{repo.language ?? "—"}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="pt-snap">{repos ? `${snapshotLabel(repos.capturedAt)} · 方块高度只是装饰` : "仓库快照 · 方块高度只是装饰"}</p>
      </section>
      <div className="pt-legend" aria-label="色阶说明：装饰用，不是真实提交数据">
        少
        {LEVEL_COLORS.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
        多（示意）
      </div>
    </div>
  );
}
