import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { findScript, type ScriptId } from "./registry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, "..");
const LOGS_DIR = resolve(__dirname, "logs");

const RING_BUFFER_MAX = 2000;

export type LogLine = {
  t: number;
  stream: "stdout" | "stderr";
  text: string;
};

export type RunStatus = "running" | "exited" | "failed" | "stopped" | "orphaned";

export type RunMeta = {
  id: string;
  scriptId: ScriptId;
  argv: string[];
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  exitCode?: number | null;
  signal?: string | null;
  progress?: { current: number; total: number };
};

type Subscriber = (event: string, data: unknown) => void;

type ActiveRun = RunMeta & {
  lines: LogLine[];
  subscribers: Set<Subscriber>;
  child?: ChildProcess;
  logPath: string;
  metaPath: string;
};

export class AlreadyRunningError extends Error {
  constructor(public runId: string) {
    super("already_running");
    this.name = "AlreadyRunningError";
  }
}

export class SpawnDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnDeniedError";
  }
}

const PROGRESS_RE = /\[(\d+)\/(\d+)\]/;

function ensureLogsDir() {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

function writeMeta(run: ActiveRun) {
  try {
    const meta: RunMeta = {
      id: run.id,
      scriptId: run.scriptId,
      argv: run.argv,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      status: run.status,
      exitCode: run.exitCode,
      signal: run.signal,
      progress: run.progress,
    };
    writeFileSync(run.metaPath, JSON.stringify(meta, null, 2));
  } catch {
    /* non-fatal */
  }
}

function appendLogLine(path: string, line: LogLine) {
  try {
    appendFileSync(
      path,
      `${new Date(line.t).toISOString()} [${line.stream}] ${line.text}\n`,
    );
  } catch {
    /* non-fatal */
  }
}

export class RunManager {
  private runs = new Map<string, ActiveRun>();

  constructor() {
    ensureLogsDir();
    this.loadHistoryFromDisk();
  }

  private loadHistoryFromDisk() {
    let files: string[];
    try {
      files = readdirSync(LOGS_DIR).filter((f) => f.endsWith(".meta.json"));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const metaPath = resolve(LOGS_DIR, f);
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as RunMeta;
        if (this.runs.has(meta.id)) continue;
        const status: RunStatus = meta.status === "running" ? "orphaned" : meta.status;
        const logPath = resolve(LOGS_DIR, `${meta.id}.log`);
        this.runs.set(meta.id, {
          ...meta,
          status,
          lines: [],
          subscribers: new Set(),
          logPath,
          metaPath,
        });
        if (status === "orphaned") {
          const persisted = { ...meta, status: "orphaned" as RunStatus };
          try {
            writeFileSync(metaPath, JSON.stringify(persisted, null, 2));
          } catch {
            /* noop */
          }
        }
      } catch {
        /* skip broken meta */
      }
    }
  }

  listRuns(limit = 20): RunMeta[] {
    const all = [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
    return all.slice(0, limit).map((r) => this.toMeta(r));
  }

  getRun(id: string): ActiveRun | undefined {
    return this.runs.get(id);
  }

  getMeta(id: string): RunMeta | undefined {
    const r = this.runs.get(id);
    return r ? this.toMeta(r) : undefined;
  }

  findActiveByScript(scriptId: ScriptId): ActiveRun | undefined {
    for (const r of this.runs.values()) {
      if (r.scriptId === scriptId && r.status === "running") return r;
    }
    return undefined;
  }

  private toMeta(r: ActiveRun): RunMeta {
    return {
      id: r.id,
      scriptId: r.scriptId,
      argv: r.argv,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      status: r.status,
      exitCode: r.exitCode,
      signal: r.signal,
      progress: r.progress,
    };
  }

  start(scriptId: ScriptId, argv: string[]): RunMeta {
    const def = findScript(scriptId);
    if (!def) throw new SpawnDeniedError(`unknown script: ${scriptId}`);

    const active = this.findActiveByScript(scriptId);
    if (active) throw new AlreadyRunningError(active.id);

    const id = randomUUID();
    const logPath = resolve(LOGS_DIR, `${id}.log`);
    const metaPath = resolve(LOGS_DIR, `${id}.meta.json`);

    const child = spawn("pnpm", ["run", def.pnpmScript, ...argv], {
      cwd: SCRIPTS_DIR,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutStream = child.stdout as Readable;
    const stderrStream = child.stderr as Readable;

    const run: ActiveRun = {
      id,
      scriptId,
      argv,
      startedAt: Date.now(),
      status: "running",
      lines: [],
      subscribers: new Set(),
      child,
      logPath,
      metaPath,
    };
    this.runs.set(id, run);
    writeMeta(run);
    appendLogLine(logPath, {
      t: run.startedAt,
      stream: "stdout",
      text: `$ pnpm run ${def.pnpmScript} ${argv.join(" ")}`,
    });

    const pushLine = (stream: "stdout" | "stderr", text: string) => {
      const line: LogLine = { t: Date.now(), stream, text };
      run.lines.push(line);
      if (run.lines.length > RING_BUFFER_MAX) run.lines.shift();
      appendLogLine(logPath, line);

      const m = text.match(PROGRESS_RE);
      if (m) {
        const current = Number(m[1]);
        const total = Number(m[2]);
        if (Number.isFinite(current) && Number.isFinite(total)) {
          run.progress = { current, total };
          this.broadcast(run, "progress", run.progress);
        }
      }
      this.broadcast(run, "line", line);
    };

    const stdoutReader = createInterface({ input: stdoutStream });
    stdoutReader.on("line", (text) => pushLine("stdout", text));
    const stderrReader = createInterface({ input: stderrStream });
    stderrReader.on("line", (text) => pushLine("stderr", text));

    child.on("error", (err) => {
      pushLine("stderr", `spawn error: ${err.message}`);
      run.status = "failed";
      run.endedAt = Date.now();
      run.exitCode = null;
      writeMeta(run);
      this.broadcast(run, "status", this.toMeta(run));
      this.broadcast(run, "end", this.toMeta(run));
      this.closeSubscribers(run);
    });

    child.on("close", (code, signal) => {
      if (run.status !== "running") {
        run.endedAt ??= Date.now();
      } else {
        run.endedAt = Date.now();
        if (signal) {
          run.status = "stopped";
        } else {
          run.status = code === 0 ? "exited" : "failed";
        }
      }
      run.exitCode = code;
      run.signal = signal ?? null;
      writeMeta(run);
      this.broadcast(run, "status", this.toMeta(run));
      this.broadcast(run, "end", this.toMeta(run));
      this.closeSubscribers(run);
    });

    return this.toMeta(run);
  }

  stop(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || !run.child || run.status !== "running") return false;
    try {
      run.child.kill("SIGTERM");
    } catch {
      return false;
    }
    run.status = "stopped";
    writeMeta(run);
    this.broadcast(run, "status", this.toMeta(run));
    setTimeout(() => {
      if (run.child && !run.child.killed) {
        try {
          run.child.kill("SIGKILL");
        } catch {
          /* noop */
        }
      }
    }, 5000);
    return true;
  }

  stopAllSync() {
    for (const run of this.runs.values()) {
      if (run.status === "running" && run.child) {
        try {
          run.child.kill("SIGTERM");
          run.status = "stopped";
          run.endedAt = Date.now();
          writeMeta(run);
        } catch {
          /* noop */
        }
      }
    }
  }

  subscribe(id: string, sub: Subscriber): (() => void) | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    for (const line of run.lines) sub("line", line);
    sub("status", this.toMeta(run));
    if (run.status !== "running") {
      sub("end", this.toMeta(run));
      return () => {
        /* already closed */
      };
    }
    run.subscribers.add(sub);
    return () => run.subscribers.delete(sub);
  }

  readLogFile(id: string): string | null {
    const run = this.runs.get(id);
    if (!run) return null;
    try {
      return readFileSync(run.logPath, "utf-8");
    } catch {
      return null;
    }
  }

  private broadcast(run: ActiveRun, event: string, data: unknown) {
    for (const sub of run.subscribers) {
      try {
        sub(event, data);
      } catch {
        /* noop */
      }
    }
  }

  private closeSubscribers(run: ActiveRun) {
    run.subscribers.clear();
  }
}
