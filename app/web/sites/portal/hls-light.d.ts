// hls.js 的精简版（无字幕、多音轨、DRM，宣传片都用不到）没有单独的类型声明，接口与完整版相同。
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
