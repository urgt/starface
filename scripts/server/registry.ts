export type ArgField =
  | { kind: "select"; name: string; label: string; options: string[]; default?: string; required?: boolean }
  | { kind: "number"; name: string; label: string; default?: number; min?: number; placeholder?: string }
  | { kind: "string"; name: string; label: string; default?: string; placeholder?: string }
  | { kind: "boolean"; name: string; label: string; default?: boolean };

export type ScriptId = "wikidata" | "enroll" | "descriptions";

export type ScriptDef = {
  id: ScriptId;
  pnpmScript: "fetch-wikidata" | "enroll" | "descriptions";
  title: string;
  description: string;
  estMinutes: [number, number];
  fields: ArgField[];
  toArgv: (values: Record<string, unknown>) => string[];
};

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const SCRIPTS: ScriptDef[] = [
  {
    id: "wikidata",
    pnpmScript: "fetch-wikidata",
    title: "Загрузка из Wikidata",
    description:
      "SPARQL-запросы + скачивание фото с Wikimedia Commons. Результат → seeds/wikidata/manifest.json.",
    estMinutes: [15, 30],
    fields: [
      {
        kind: "select",
        name: "category",
        label: "Категория",
        options: ["all", "uz", "cis", "world"],
        default: "uz",
      },
      { kind: "number", name: "limit", label: "Лимит (пусто = дефолт)", min: 1, placeholder: "50" },
      { kind: "string", name: "out-dir", label: "Каталог вывода", placeholder: "./seeds/wikidata" },
    ],
    toArgv: (v) => {
      const argv: string[] = [];
      const category = str(v.category);
      if (category) argv.push("--category", category);
      const limit = num(v.limit);
      if (limit !== null) argv.push("--limit", String(limit));
      const outDir = str(v["out-dir"]);
      if (outDir) argv.push("--out-dir", outDir);
      return argv;
    },
  },
  {
    id: "enroll",
    pnpmScript: "enroll",
    title: "Enroll знаменитостей",
    description:
      "Локальный GPU (DINOv2 ViT-L/14 на Python) → батчами по 25 POST на /api/admin/enroll. Использует modal_app/pipeline.py, так что embedding space совпадает с Modal. Резюмируется через scripts/seed/py/.seed-progress.json.",
    estMinutes: [5, 30],
    fields: [
      { kind: "string", name: "manifest", label: "Путь к manifest.json", placeholder: "./seeds/wikidata/manifest.json" },
      {
        kind: "select",
        name: "category",
        label: "Фильтр по категории",
        options: ["", "uz", "cis", "world"],
        default: "",
      },
      { kind: "number", name: "limit", label: "Лимит", min: 1, placeholder: "без ограничения" },
      { kind: "boolean", name: "reset-progress", label: "Сбросить .seed-progress.json", default: false },
      { kind: "boolean", name: "dry-run", label: "Dry run (не POST-ить)", default: false },
    ],
    toArgv: (v) => {
      const argv: string[] = [];
      const manifest = str(v.manifest);
      if (manifest) argv.push("--manifest", manifest);
      const category = str(v.category);
      if (category) argv.push("--category", category);
      const limit = num(v.limit);
      if (limit !== null) argv.push("--limit", String(limit));
      if (v["reset-progress"] === true) argv.push("--reset-progress");
      if (v["dry-run"] === true) argv.push("--dry-run");
      return argv;
    },
  },
  {
    id: "descriptions",
    pnpmScript: "descriptions",
    title: "Генерация описаний",
    description:
      "Извлечение Wikipedia → локальный LLM (LM Studio / Ollama) → PATCH описаний на /api/admin/celebrities/:id в трёх языках.",
    estMinutes: [10, 60],
    fields: [
      { kind: "number", name: "limit", label: "Лимит", min: 1, placeholder: "все недостающие" },
      { kind: "number", name: "sleep", label: "Пауза между запросами (мс)", min: 0, default: 300 },
    ],
    toArgv: (v) => {
      const argv: string[] = [];
      const limit = num(v.limit);
      if (limit !== null) argv.push("--limit", String(limit));
      const sleep = num(v.sleep);
      if (sleep !== null) argv.push("--sleep", String(sleep));
      return argv;
    },
  },
];

export function findScript(id: string): ScriptDef | undefined {
  return SCRIPTS.find((s) => s.id === id);
}

export function publicScripts() {
  return SCRIPTS.map(({ toArgv: _toArgv, ...rest }) => rest);
}
