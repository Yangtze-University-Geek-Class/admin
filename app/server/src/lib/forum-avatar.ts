import { createHash } from "node:crypto";
import sharp from "sharp";
import { FORUM_LIMITS, ForumError } from "./forum-rules.js";

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const DECODED_FORMATS = new Set(["png", "jpeg", "webp"]);

/**
 * 头像上传（#57）：解码上传的 PNG / JPEG / WebP，按 EXIF 摆正，居中裁成正方形，缩到 256×256，重新编码成 WebP。
 * 输出里不带原图的任何元数据（sharp 默认丢弃 EXIF / ICC 之外的信息，这里也不保留 ICC）。
 *
 * - 像素上限 `avatarPixelsMax`：声明巨大画布的文件在解码前就被拒绝（sharp 的 limitInputPixels）。
 * - 动图只取第一帧（`animated: false`），多帧 WebP 不会被逐帧解码。
 * - 以解码出的真实格式为准，请求头的 Content-Type 只是第一道筛子。
 */
export async function processAvatar(input: Buffer): Promise<{ hash: string; data: Buffer }> {
  let data: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: FORUM_LIMITS.avatarPixelsMax, animated: false, failOn: "error" });
    const { format } = await image.metadata();
    if (!format || !DECODED_FORMATS.has(format)) throw new ForumError(400, "invalid_image", "头像只支持 PNG、JPEG、WebP 图片");
    data = await image
      .rotate()
      .resize(FORUM_LIMITS.avatarSize, FORUM_LIMITS.avatarSize, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (cause) {
    if (cause instanceof ForumError) throw cause;
    if (/pixel limit/i.test((cause as Error)?.message ?? "")) throw new ForumError(400, "image_too_large", "图片尺寸太大，请换一张小一点的图");
    throw new ForumError(400, "invalid_image", "没能读出这张图片，请换一张 PNG、JPEG 或 WebP");
  }
  return { hash: createHash("sha256").update(data).digest("hex"), data };
}
