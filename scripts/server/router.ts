import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { findScript, publicScripts, type ScriptId } from "./registry.ts";
import { AlreadyRunningError, SpawnDeniedError, type RunManager } from "./runs.ts";
import { buildEnvReport } from "./env-check.ts";
import { readSeedProgress } from "./progress.ts";
import { openSse } from "./sse.ts";

const __dirname = resolve(import.meta.dirname ?? "");
const UI_PATH = resolve(__dirname, "ui.html");

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export function createRouter(runs: RunManager) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && (path === "/" || path === "/index.html")) {
        const html = readFileSync(UI_PATH, "utf-8");
        text(res, 200, html, "text/html; charset=utf-8");
        return;
      }

      if (method === "GET" && path === "/api/scripts") {
        return json(res, 200, publicScripts());
      }

      if (method === "GET" && path === "/api/env") {
        const report = await buildEnvReport();
        return json(res, 200, report);
      }

      if (method === "GET" && path === "/api/progress") {
        const file = url.searchParams.get("file") ?? undefined;
        return json(res, 200, readSeedProgress(file));
      }

      if (method === "GET" && path === "/api/runs") {
        return json(res, 200, runs.listRuns(50));
      }

      if (method === "POST" && path === "/api/runs") {
        const raw = await readBody(req);
        let body: { scriptId?: string; values?: Record<string, unknown> };
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return json(res, 400, { error: "invalid_json" });
        }
        const def = findScript(body.scriptId ?? "");
        if (!def) return json(res, 400, { error: "unknown_script" });
        const argv = def.toArgv(body.values ?? {});
        try {
          const meta = runs.start(def.id as ScriptId, argv);
          return json(res, 201, meta);
        } catch (err) {
          if (err instanceof AlreadyRunningError) {
            return json(res, 409, { error: "already_running", runId: err.runId });
          }
          if (err instanceof SpawnDeniedError) {
            return json(res, 400, { error: err.message });
          }
          return json(res, 500, { error: (err as Error).message });
        }
      }

      const runMatch = path.match(/^\/api\/runs\/([^/]+)(?:\/(events|stop|log))?$/);
      if (runMatch) {
        const id = runMatch[1];
        const sub = runMatch[2];

        if (method === "GET" && !sub) {
          const meta = runs.getMeta(id);
          if (!meta) return json(res, 404, { error: "not_found" });
          return json(res, 200, meta);
        }

        if (method === "GET" && sub === "events") {
          const meta = runs.getMeta(id);
          if (!meta) return json(res, 404, { error: "not_found" });
          const conn = openSse(req, res);
          const unsubscribe = runs.subscribe(id, (event, data) => {
            conn.send(event, data);
            if (event === "end") conn.close();
          });
          if (!unsubscribe) conn.close();
          req.on("close", () => unsubscribe?.());
          return;
        }

        if (method === "GET" && sub === "log") {
          const body = runs.readLogFile(id);
          if (body === null) return json(res, 404, { error: "not_found" });
          return text(res, 200, body);
        }

        if (method === "POST" && sub === "stop") {
          const stopped = runs.stop(id);
          if (!stopped) return json(res, 409, { error: "not_running_or_missing" });
          return json(res, 200, { ok: true });
        }
      }

      return json(res, 404, { error: "not_found" });
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  };
}
