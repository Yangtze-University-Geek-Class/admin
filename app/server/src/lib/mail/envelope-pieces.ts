/**
 * 信封模板的固定尺寸图片部件（#148）。
 *
 * 图片不进仓库，也不进 server 镜像：生成后上传到 CDN（正式发信用 https://cdn.crosery.com/yzgc/mail/v1/），
 * 渲染时由调用方传入 assetBase 拼出地址。文件名带内容 sha256 的前 8 位，换图必然换名，已发出的邮件继续指向旧图。
 * width / height 是邮件里显示的尺寸（CSS 像素），文件本身按 2 倍导出。
 * 生成方法、原图来源和上传步骤见 docs/services/server/mail.md。
 */
export const ENVELOPE_PIECES = {
  /** 极客娘在信纸后面挥手，旁边一只拆开的航空信封；底边就是信纸的上沿，透明底 */
  header: { file: "header-653d0976.png", width: 600, height: 220 },
  /** 带齿孔的邮票（校徽 + 极客班）和 YUGC 邮戳，邮戳用比钴蓝浅的蓝，深色模式下也看得清；透明底 */
  stamp: { file: "stamp-5c638b76.png", width: 150, height: 100 },
  /** 落款旁的钴蓝火漆，边上一圈浅色描边，深色模式下能看出轮廓；透明底 */
  seal: { file: "seal-e9c4d486.png", width: 72, height: 72 },
  /** 信纸下沿的航空条纹，条纹之间透明，下面两个角是 4px 圆角（和信纸一样） */
  airmail: { file: "airmail-4f4c24ba.png", width: 600, height: 12 },
} as const;

export type EnvelopePiece = keyof typeof ENVELOPE_PIECES;
