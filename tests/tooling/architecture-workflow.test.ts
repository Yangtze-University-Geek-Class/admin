import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/architecture-alignment.yml", import.meta.url), "utf8");
it("checks all pull requests and edited bodies without skip labels or path filters", () => {
  expect(workflow).toContain("pull_request:");
  for (const event of ["opened", "reopened", "synchronize", "edited", "ready_for_review"]) expect(workflow).toContain(event);
  expect(workflow).not.toMatch(/\b(?:paths|paths-ignore|branches|branches-ignore):/);
  expect(workflow).not.toContain("continue-on-error");
  expect(workflow).not.toContain("exit 0");
  expect(workflow).not.toContain("pull_request_target");
});
it("uses the base policy when available and checks candidate Git objects as data", () => {
  expect(workflow).toContain('git show "${BASE_SHA}:scripts/check-architecture.mjs" > "$policy"');
  expect(workflow).toContain('--base "$BASE_SHA" --head "$HEAD_SHA"');
  expect(workflow).toContain('--branch "$HEAD_REF" --body-file');
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("contents: read");
  expect(workflow).not.toContain("secrets.");
  expect(workflow).not.toMatch(/pnpm install|npm install/);
  expect(workflow).toContain('cp scripts/check-architecture.mjs "$policy"');
  expect(workflow).toContain('node "$policy"');
});
