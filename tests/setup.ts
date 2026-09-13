import { afterEach } from "vitest";
// DOM-only cleanup. Server tests never import browser code or load .env.
if (typeof document !== "undefined") {
  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });
}
