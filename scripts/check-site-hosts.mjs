#!/usr/bin/env node
// Build-time checks consume public configuration only. Runtime host matching
// belongs to the explicit application startup path, not a secret-file read here.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "web/shared/config/app.config.json"), "utf8"));
const hosts = [];
for (const site of ["portal", "forum", "admin"]) {
  const host = config.sites[site]?.host;
  if (typeof host !== "string" || !/^[a-z0-9.-]+$/.test(host)) throw new Error(`Invalid public site hostname: ${site}`);
  if (hosts.includes(host)) throw new Error(`Duplicate public site hostname: ${site}`);
  hosts.push(host);
}
if (config.environment.production.dataSource !== "live" || config.environment.production.allowDataSourceOverride) throw new Error("Production data source must be fixed to live");
console.log("Public site hosts and production data-source policy passed.");
