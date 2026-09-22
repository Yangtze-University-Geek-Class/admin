import { describe, expect, it } from "vitest";
import { loadOrder } from "../../app/web/sites/portal/lib/frameSequence";

describe("滚动帧序列加载顺序", () => {
  it("首帧最先，随后按步长逐级加密，覆盖全部帧且不重复", () => {
    for (const count of [1, 2, 7, 24, 36]) {
      const order = loadOrder(count);
      expect(order[0]).toBe(0);
      expect(new Set(order).size).toBe(count);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index));
    }
    // 24 帧：先 0 和 16，再 8，再 4、12、20……（前几帧就能粗略覆盖整段）
    expect(loadOrder(24).slice(0, 4)).toEqual([0, 16, 8, 4]);
  });
});
