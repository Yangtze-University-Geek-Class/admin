type Environment = Record<string, string | undefined>;
type NoticeMeta = { name: string; content: string };

// 不绑定某一端的 Vite 类型：官网、控制台和论坛使用不同版本的打包器。
export declare function securityNoticeMeta(env?: Environment): NoticeMeta[];
export declare function productionSecurityNotice(env?: Environment): {
  name: string;
  apply: "build";
  outputOptions(this: { meta: object }, options: object): null;
  renderChunk: {
    order: "post";
    handler(this: { meta: object }, code: string, chunk: { isEntry: boolean }): { code: string; map: null } | null;
  };
  transformIndexHtml(): { tag: "meta"; attrs: NoticeMeta; injectTo: "head" }[];
};
export declare function verifySecurityNotice(options: {
  root: string;
  entry: string;
  base?: string;
  env?: Environment;
}): { entry: string; environment: string; scripts: number; notice: boolean };
