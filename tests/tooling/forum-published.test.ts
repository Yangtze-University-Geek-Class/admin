import { describe, expect, it } from "vitest";
import { applyRedactions, cleanUrl, publishedProblems, rewriteLinks, topicIdOf } from "../../scripts/forum-migration/published-transform.mjs";

// scripts/forum-migration/export-published.mjs 的纯函数部分（#87）。输入全是编出来的，不碰私有快照。
const titles = new Map([
  ["t9", "第四期极客班招新机试指南"],
  ["t12", "linux虚拟机安装和使用"],
]);
const noImages = () => null;

describe("旧论坛话题地址", () => {
  it("站内相对地址、旧归档地址和旧话题页都认成话题编号", () => {
    expect(topicIdOf("/t/t9")).toBe("t9");
    expect(topicIdOf("https://yangtzeu.work/forum/archive/t/12")).toBe("t12");
    expect(topicIdOf("https://www.yangtzeu.work/t/t35/")).toBe("t35");
    expect(topicIdOf("/c/问答专区")).toBeNull();
    expect(topicIdOf("https://example.com/t/t9")).toBeNull();
  });
});

describe("rewriteLinks", () => {
  it("指向公开话题的链接改成相对地址，只写旧站名的链接文字换成话题标题", () => {
    const { content, report } = rewriteLinks(
      "参考：[长江大学极客班 (yangtzeu.work)](/t/t9)\n- [看这篇](https://yangtzeu.work/forum/archive/t/12)",
      { titles, image: noImages },
    );
    expect(content).toBe("参考：[第四期极客班招新机试指南](./t9)\n- [看这篇](./t12)");
    expect(report.topicLinks.map((link: { to: string }) => link.to)).toEqual(["t9", "t12"]);
  });

  it("指向不公开话题的链接变成「这篇没有公开」，不留链接", () => {
    const { content, report } = rewriteLinks("## 教程地址\n\n[长江大学极客班](/t/t5)\n另见[代理配置](/t/t5)", { titles, image: noImages });
    expect(content).toBe("## 教程地址\n\n这篇没有公开\n另见代理配置（这篇没有公开）");
    expect(report.withheldLinks).toHaveLength(2);
  });

  it("旧论坛的分类、用户页链接去掉链接只留文字；外部链接不动", () => {
    const { content, report } = rewriteLinks("打开[问答专区](/c/问答专区)，或者看 [VS Code](https://code.visualstudio.com/)", { titles, image: noImages });
    expect(content).toBe("打开问答专区，或者看 [VS Code](https://code.visualstudio.com/)");
    expect(report.unlinked).toEqual([{ from: "/c/问答专区", text: "问答专区" }]);
    // 只写了旧站名的链接文字一起去掉
    expect(rewriteLinks("问答专区[长江大学极客班 (yangtzeu.work)](/c/问答专区)（先登录）", { titles, image: noImages }).content).toBe("问答专区（先登录）");
  });

  it("本地图片换成导出的相对路径，外部图片保留", () => {
    const image = (target: string) => (target.startsWith("bbs/") ? "../published/abc.webp" : null);
    const { content } = rewriteLinks("![img](bbs/1.png)\n![x](https://oss.example.com/a.png)", { titles, image });
    expect(content).toBe("![img](../published/abc.webp)\n![x](https://oss.example.com/a.png)");
  });

  it("清单要求去掉的图片换成一句括号说明", () => {
    const { content, report } = rewriteLinks("看图：\n![a](https://oss.example.com/x.png)", { titles, image: () => ({ text: "这张截图没有公开" }) });
    expect(content).toBe("看图：\n（这张截图没有公开）");
    expect(report.droppedImages).toHaveLength(1);
  });

  it("外部链接去掉分享人的追踪参数，其它参数保留", () => {
    const { content, report } = rewriteLinks("[视频](https://www.bilibili.com/video/BV1x/?spm_id_from=333.1&vd_source=abc&t=12)", { titles, image: noImages });
    expect(content).toBe("[视频](https://www.bilibili.com/video/BV1x/?t=12)");
    expect(report.cleanedLinks).toHaveLength(1);
  });

  it("代码块里的内容原样保留，列表项里开的代码块也算", () => {
    const md = "- ```cmd\n  [长江大学极客班](/t/t9)\n  ```\n[长江大学极客班](/t/t9)";
    const { content } = rewriteLinks(md, { titles, image: noImages });
    expect(content).toBe("- ```cmd\n  [长江大学极客班](/t/t9)\n  ```\n[第四期极客班招新机试指南](./t9)");
  });
});

describe("applyRedactions", () => {
  const rule = { pattern: "（\\*\\*账户\\*\\*：[^）]*）", replacement: "（共享账户找班长要）", count: 1 };

  it("按规则替换，命中次数和清单一致", () => {
    expect(applyRedactions("教程（**账户**：someone **密码**：x）", [rule], "t73")).toBe("教程（共享账户找班长要）");
  });

  it("命中次数对不上就停下，不发布只替换了一半的正文", () => {
    expect(() => applyRedactions("没有账户这一行", [rule], "t73")).toThrow(/应命中 1 次，实际 0 次/);
    expect(() => applyRedactions("（**账户**：a）（**账户**：b）", [rule], "t73")).toThrow(/实际 2 次/);
  });
});

describe("publishedProblems", () => {
  it("导出后的正文里还有旧资产地址、旧归档链接、邮箱或写出来的账户，都报出来", () => {
    expect(publishedProblems("![a](/api/local-forum/assets/ab)")).toHaveLength(1);
    expect(publishedProblems("![a](bbs/1.png)")).toHaveLength(1);
    expect(publishedProblems("见 https://yangtzeu.work/forum/archive/t/3")).toHaveLength(1);
    expect(publishedProblems("联系 someone@example.com")).toHaveLength(1);
    expect(publishedProblems("**账户**：abc")).toHaveLength(1);
    expect(publishedProblems("[第四期极客班招新机试指南](./t9)\n![img](../published/abc.webp)")).toEqual([]);
  });
});

describe("cleanUrl", () => {
  it("gitee 的外链跳转换成目标地址，再去掉追踪参数", () => {
    expect(cleanUrl("https://gitee.com/link?target=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1U%2F%3Fspm_id_from%3D333%26vd_source%3Dabc")).toBe("https://www.bilibili.com/video/BV1U/");
  });

  it("公众号文章去掉分享人参数，保留定位文章的参数", () => {
    const cleaned = new URL(cleanUrl("https://mp.weixin.qq.com/s?__biz=M&mid=1&idx=1&sn=s&sharer_shareinfo=x&sharer_shareinfo_first=y&srcid=z"));
    expect([...cleaned.searchParams.keys()]).toEqual(["__biz", "mid", "idx", "sn"]);
  });

  it("没有要清的参数、或者不是 http 地址时原样返回", () => {
    expect(cleanUrl("https://code.visualstudio.com/")).toBe("https://code.visualstudio.com/");
    expect(cleanUrl("./t9")).toBe("./t9");
    expect(cleanUrl("https://www.bilibili.com/video/BV1x/?t=5")).toBe("https://www.bilibili.com/video/BV1x/?t=5");
  });
});
