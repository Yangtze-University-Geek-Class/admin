import type { FastifyInstance } from "fastify";

/**
 * 本站启用的登录方式（#262）：统一登录页按顺序渲染，前端不写死任何渠道。交付 1 只有 GitHub，它也是唯一能建号的方式
 * （`can_register`）；邮箱验证码（交付 2）在配了发信商时、Google（交付 3）在配了凭据时才出现。
 */
export type LoginProvider = {
  id: "github" | "google" | "email";
  name: string;
  kind: "redirect" | "email_code";
  /** redirect：整页跳转地址，前端追加 `return_to`；email_code：发验证码的接口 */
  start: string;
  can_register: boolean;
};

export const GITHUB_PROVIDER: LoginProvider = { id: "github", name: "GitHub", kind: "redirect", start: "/auth/github", can_register: true };

export function loginProviders(): LoginProvider[] {
  return [GITHUB_PROVIDER];
}

export default async function providerRoutes(app: FastifyInstance) {
  app.get("/auth/providers", async () => ({ providers: loginProviders() }));
}
