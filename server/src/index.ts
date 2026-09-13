import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const app = await buildApp({ config, logger: true });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  await app.listen({ port: config.port, host: "127.0.0.1" });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
