import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FORUM_LIMITS, ForumError } from "../../lib/forum-rules.js";
import { notFound, requireWriter } from "./viewer.js";
import { hourlyLimited } from "./forum-limits.js";
import { uploadKey } from "../../lib/object-storage.js";

const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const DECODED_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

/**
 * 上传图片（#276 CONTRACT §5）：请求体就是图片本身（png/jpeg/webp/gif，≤5MB，≤4096×4096），sharp 转 webp
 * 存（gif 保留动图），按 sha256 按内容寻址，和头像、表情同一种存法；gif 原样保留动图，其余转 webp。
 */
async function processUpload(input: Buffer): Promise<{ hash: string; mime: string; data: Buffer; width: number; height: number }> {
  let data: Buffer; let mime: string; let width: number; let height: number;
  try {
    const image = sharp(input, { limitInputPixels: FORUM_LIMITS.uploadPixelsMax, animated: true, failOn: "error" });
    const meta = await image.metadata();
    if (!meta.format || !DECODED_FORMATS.has(meta.format)) throw new ForumError(400, "invalid_image", "只支持 PNG、JPEG、WebP、GIF 图片");
    if (meta.format === "gif" && (meta.pages ?? 1) > 1) {
      // 动图保留动图：原样存，不重新编码（sharp 转 webp 的动图路径代价更高，内容寻址足够去重）。
      data = input; mime = "image/gif"; width = meta.width ?? 0; height = meta.height ?? 0;
    } else {
      data = await sharp(input, { limitInputPixels: FORUM_LIMITS.uploadPixelsMax, failOn: "error" }).rotate().webp({ quality: 85 }).toBuffer();
      mime = "image/webp";
      const out = await sharp(data).metadata();
      width = out.width ?? 0; height = out.height ?? 0;
    }
  } catch (cause) {
    if (cause instanceof ForumError) throw cause;
    if (/pixel limit/i.test((cause as Error)?.message ?? "")) throw new ForumError(400, "image_too_large", "图片尺寸太大，请换一张小一点的图");
    throw new ForumError(400, "invalid_image", "没能读出这张图片，请换一张 PNG、JPEG、WebP 或 GIF");
  }
  return { hash: createHash("sha256").update(data).digest("hex"), mime, data, width, height };
}

export default async function forumUploadRoutes(app: FastifyInstance) {
  const { forum, objectStorage } = app.services;

  await app.register(async uploadApp => {
    uploadApp.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: FORUM_LIMITS.uploadBytesMax }, (_req, body, done) => done(null, body));
    const tooLarge = (error: { code?: string }, _req: FastifyRequest, reply: FastifyReply) => {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ error: "upload_too_large", message: "图片不能超过 5MB" });
      throw error;
    };
    // 登录与权限先于读请求体判断（和头像上传同一个顾虑）：没资格的人连大图片都不用先被服务器读进内存。
    const requireUploader = async (req: FastifyRequest) => { await requireWriter(req, "forum.upload.image"); };

    uploadApp.put("/api/forum/uploads", { onRequest: requireUploader, errorHandler: tooLarge }, async (req, reply) => {
      const viewer = await requireWriter(req, "forum.upload.image");
      if (hourlyLimited(req, reply, "upload", viewer.accountId)) return;
      const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!(UPLOAD_TYPES as readonly string[]).includes(type) || !Buffer.isBuffer(req.body)) {
        throw new ForumError(415, "unsupported_media_type", "只支持 PNG、JPEG、WebP、GIF 图片");
      }
      const { hash, mime, data, width, height } = await processUpload(req.body);
      let url: string;
      if (objectStorage.enabled) {
        // 对象存储开启（#352）：字节写七牛、库里不存，返回的就是公开地址。
        url = await objectStorage.ensure(uploadKey(hash, mime), data, mime).catch(() => {
          throw new ForumError(503, "object_storage_unavailable", "图片暂时存不下，请稍后再试");
        });
      } else {
        forum.saveUpload(hash, mime, data, width, height, viewer.accountId);
        url = `/api/forum/uploads/${hash}.${mime === "image/gif" ? "gif" : "webp"}`;
      }
      app.services.activity.recordActivity(req, { action: "forum.upload.image", surface: "forum", target_type: "upload", target_id: hash, outcome: "ok" });
      return { url, width, height };
    });
  });

  app.get<{ Params: { file: string } }>("/api/forum/uploads/:file", async (req, reply) => {
    const dot = req.params.file.lastIndexOf(".");
    const hash = req.params.file.slice(0, dot);
    const upload = forum.uploadFile(hash);
    if (!upload) throw notFound("图片不存在");
    return reply
      .header("Content-Type", upload.mime)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'")
      .send(upload.bytes);
  });
}
