import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_CDN_BASE } from '../../scripts/static-cdn-base.mjs';

// 静态资源 CDN（#146）在两条部署工作流里的接线：上传 token 只进 cdn-plan、cdn-upload 两个不装依赖的 job，
// build job 按开关构建并挑文件，deploy 等 cdn-upload 成功。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

/** 截出工作流里某个 job（两格缩进的 `<id>:` 到下一个同级 key），与 build-mirrors.test.ts 相同。 */
function job(workflow: string, id: string) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`工作流里找不到 job ${id}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 2);
}

/** 截出 job 里某一步的 `run: |` 脚本（去掉缩进前的原文）。 */
function stepRun(block: string, name: string) {
  const start = block.indexOf(`\n      - name: ${name}\n`);
  if (start < 0) throw new Error(`找不到这一步：${name}`);
  const rest = block.slice(start + 1);
  const next = rest.slice(1).search(/\n {6}- name: /);
  const step = next < 0 ? rest : rest.slice(0, next + 2);
  const run = /\n {8}run: \|\n((?: {10}.*\n)+)/.exec(step);
  if (!run) throw new Error(`这一步没有 run 脚本：${name}`);
  return run[1];
}
const EXTRACT = '取出要上传 CDN 的带哈希文件（开关打开时）';

describe('deploy workflows', () => {
  const workflows = { preview: read('.github/workflows/deploy-preview.yml'), production: read('.github/workflows/deploy-production.yml') };
  const ENVIRONMENT = '    environment:\n      name: static-cdn\n      deployment: false\n';
  const GATE = "        if: needs.cdn-plan.outputs.base != ''\n";

  it('keep the upload token out of the build job: it appears only in cdn-plan and cdn-upload, which install nothing', () => {
    for (const [name, text] of Object.entries(workflows)) {
      expect(text.match(/secrets\.STATIC_CDN_UPLOAD_TOKEN/g), name).toHaveLength(2);
      for (const id of ['cdn-plan', 'cdn-upload']) {
        const block = job(text, id);
        expect(block, `${name} ${id}`).toContain('          STATIC_CDN_UPLOAD_TOKEN: ${{ secrets.STATIC_CDN_UPLOAD_TOKEN }}\n');
        expect(block, `${name} ${id}`).toContain(ENVIRONMENT);
        expect(block, `${name} ${id}`).not.toMatch(/^ *[^ #\n].*(?:pnpm|npm (?:ci|install)|docker )/m);
      }
      expect(job(text, 'build'), name).not.toMatch(/secrets\.|environment:/);
    }
    // CI 按开关打开构建（docker-cdn），但不上传：没有 token、没有 secrets、不挂 Environment。
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/STATIC_CDN_UPLOAD_TOKEN|secrets\.|environment:|static-cdn\.mjs (?:upload|decide|mint-token)/);
  });

  it('build with the decided base, upload, and only then deploy; with the switch off every upload step is skipped', () => {
    for (const [name, text] of Object.entries(workflows)) {
      expect(job(text, 'cdn-plan'), name).toContain(`node scripts/static-cdn.mjs decide --origin "$ORIGIN" >> "$GITHUB_OUTPUT"`);
      const build = job(text, 'build');
      expect(build, name).toMatch(/\n {4}needs: \[plan, (?:evidence, )?cdn-plan\]\n/);
      expect(build, name).toContain('          STATIC_CDN_BASE: ${{ needs.cdn-plan.outputs.base }}\n');
      expect(build, name).toContain('              server) cdn_args=() ;;\n              *) cdn_args=(--build-arg STATIC_CDN_BASE="$STATIC_CDN_BASE") ;;\n');
      expect(build, name).toContain('              "${mirror_args[@]}" \\\n              "${cdn_args[@]}" \\\n');
      expect(build.split(GATE), name).toHaveLength(3);
      const upload = job(text, 'cdn-upload');
      expect(upload, name).toMatch(/\n {4}name: cdn-upload \(/);
      expect(upload, name).toContain('    needs: [plan, cdn-plan, build]\n');
      const steps = upload.split('\n      - name: ').slice(1);
      expect(steps[0], name).toMatch(/^开关状态\n/);
      for (const step of steps.slice(1)) expect(step, `${name}: ${step.split('\n')[0]}`).toContain(GATE.trimStart());
      expect(upload, name).toContain('node scripts/static-cdn.mjs upload --web "$RUNNER_TEMP/static-cdn/web" --forum "$RUNNER_TEMP/static-cdn/forum"');
      expect(upload, name).toContain('--referer "${ORIGIN}/"');
      expect(job(text, 'deploy'), name).toContain('    needs: [plan, build, cdn-upload]\n');
    }
  });
});

describe('ci: the switch-on build path runs on every push, without uploading', () => {
  const ci = read('.github/workflows/ci.yml');
  const cdn = job(ci, 'docker-cdn');

  it('builds web and forum with the one allowed STATIC_CDN_BASE, and server not at all', () => {
    expect(cdn).toContain(`      STATIC_CDN_BASE: ${STATIC_CDN_BASE}\n`);
    // 第一步先用 scripts/static-cdn-base.mjs 核对这个值，不另写一份规则。
    expect(stepRun(cdn, '核对开关值并解析提交态的发布身份')).toContain('await import("./scripts/static-cdn-base.mjs")');
    const build = stepRun(cdn, '按开关打开构建 web、forum 镜像');
    expect(build).toContain('for service in web forum; do\n');
    expect(build).toContain('--build-arg STATIC_CDN_BASE="$STATIC_CDN_BASE" \\\n');
    expect(build).toContain('--build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \\\n');
    expect(cdn).not.toMatch(/server/);
  });

  it('extracts and plans exactly like the build job of both deploy workflows, and the summary job requires it', () => {
    const script = stepRun(cdn, EXTRACT);
    expect(script).toContain('node scripts/static-cdn.mjs plan --web "${out}/web" --forum "${out}/forum"\n');
    for (const name of ['deploy-preview', 'deploy-production']) {
      expect(stepRun(job(read(`.github/workflows/${name}.yml`), 'build'), EXTRACT), name).toBe(script);
    }
    const verify = job(ci, 'verify');
    expect(verify).toMatch(/\n {4}needs: \[[^\]]*\bdocker-cdn\b[^\]]*\]\n/);
    expect(verify).toContain('          DOCKER_CDN_RESULT: ${{ needs.docker-cdn.result }}\n');
    expect(verify).toContain('[ "$DOCKER_CDN_RESULT" != "success" ]');
    expect(cdn).not.toMatch(/continue-on-error|\|\| true/);
  });
});
