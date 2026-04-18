import { createServer } from "node:http";

import { createRouter } from "./router.ts";
import { RunManager } from "./runs.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5173);

const runs = new RunManager();
const handler = createRouter(runs);

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[scripts-ui] listening on http://${HOST}:${PORT}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[scripts-ui] received ${signal}, stopping child processes…`);
  runs.stopAllSync();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
