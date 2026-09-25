// @vitest-environment jsdom
// 播放层分包加载失败（断网、发版后旧页面找不到新文件名）时不能让整个官网卸载：当作「播放失败」直接结束。
import { render, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { expect, it, vi } from "vitest";

vi.mock("../../app/web/sites/portal/components/PromoPlayer", () => {
  throw new Error("chunk load failed");
});

import { LazyPromoPlayer } from "../../app/web/sites/portal/components/PromoLazy";

it("分包加载失败时调用 onClose(\"failed\")，不抛到外面；父组件重渲染换了新的 onClose 也只调一次", async () => {
  const onClose = vi.fn();
  const view = render(
    <Suspense fallback={null}>
      <LazyPromoPlayer mode="gate" onClose={(reason) => onClose(reason)} />
    </Suspense>,
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
  view.rerender(
    <Suspense fallback={null}>
      <LazyPromoPlayer mode="gate" onClose={(reason) => onClose(reason)} />
    </Suspense>,
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});
