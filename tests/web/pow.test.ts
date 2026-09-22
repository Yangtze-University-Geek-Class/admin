import { describe, expect, it } from "vitest";
import { computePow, powProof } from "../../app/web/shared/lib/pow";

describe("公开表单 PoW 证明", () => {
  it("提交体只含 timestamp 与 nonce（服务端契约 additionalProperties: false）", async () => {
    const pow = await computePow("fb:org:内容", 1);
    expect(pow).toHaveProperty("tries");
    const proof = powProof(pow);
    expect(Object.keys(proof).sort()).toEqual(["nonce", "timestamp"]);
    expect(proof).toEqual({ timestamp: pow.timestamp, nonce: pow.nonce });
  });
});
