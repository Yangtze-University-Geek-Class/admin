import type { FastifyInstance, FastifySchema } from "fastify";

export const text = (maxLength: number, minLength = 0) => ({ type: "string", minLength, maxLength });
export const integer = (minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => ({ type: "integer", minimum, maximum });
export const flag = { type: "integer", enum: [0, 1] };
export const optionalId = { anyOf: [integer(), { type: "null" }] };
export const nullableText = (maxLength: number) => ({ anyOf: [text(maxLength), { type: "null" }] });
export function object(properties: Record<string, unknown>, required: string[] = [], additionalProperties = false) {
  return { type: "object", properties, required, additionalProperties };
}
export const body = (properties: Record<string, unknown>, required: string[] = []) => ({ body: object(properties, required) });
export const choices = (...values: string[]) => ({ type: "string", enum: values });
export type RouteContracts = Record<string, FastifySchema>;

/** Module-owned contracts are applied before Fastify compiles its validators. */
export function registerContracts(app: FastifyInstance, contracts: RouteContracts) {
  app.addHook("onRoute", route => {
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    const properties: Record<string, unknown> = {};
    for (const match of route.url.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      const name = match[1];
      properties[name] = ["id", "n", "user_id"].includes(name)
        ? { type: "string", pattern: "^[1-9][0-9]{0,14}$" }
        : text(name === "token" ? 128 : 255, 1);
    }
    route.schema = {
      params: object(properties, Object.keys(properties)),
      querystring: object({
        page: { type: "string", pattern: "^[1-9][0-9]{0,5}$" },
        limit: { type: "string", pattern: "^[1-9][0-9]{0,3}$" },
        per_page: { type: "string", pattern: "^[1-9][0-9]{0,2}$" },
        offset: { type: "string", pattern: "^[0-9]{1,8}$" },
        q: text(200),
      }, [], true),
      ...contracts[`${method} ${route.url}`],
      ...route.schema,
    };
  });
}
