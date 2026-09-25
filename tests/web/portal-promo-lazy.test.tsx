// @vitest-environment jsdom
// 播放层分包加载失败（断网、发版后旧页面找不到新文件名）时不能让整个官网卸载：当作「播放失败」直接结束。
import { render, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { expect, it, vi } from "vitest";

vi.mock("../../app/web/sites/portal/components/PromoPlayer", () => {
  throw new Error("chunk load failed");
});

import { LazyPromoPlayer } from "../../app/web/sites/portal/components/PromoLazy";

it("分包加载失败时调用 onClose(\"failed\")，不抛到外面", async () => {
  const onClose = vi.fn();
  render(
    <Suspense fallback={null}>
      <LazyPromoPlayer mode="gate" onClose={onClose} />
    </Suspense>,
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
});
