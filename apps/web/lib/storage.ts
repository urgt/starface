import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { appConfig } from "./config";

export async function saveUserPhoto(base64: string): Promise<{ relativePath: string; absolutePath: string }> {
  const cleaned = base64.includes(",") ? base64.split(",", 2)[1] : base64;
  const buffer = Buffer.from(cleaned, "base64");
  const name = `${randomUUID()}.jpg`;
  const dir = path.join(appConfig.dataDir, "users");
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, name);
  await fs.writeFile(absolutePath, buffer);
  return { relativePath: `users/${name}`, absolutePath };
}

export async function saveCelebrityPhoto(
  buffer: Buffer,
  originalExt: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  const ext = (originalExt || "jpg").replace(/^\./, "").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const name = `${randomUUID()}.${safeExt}`;
  const dir = path.join(appConfig.dataDir, "celebrities");
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, name);
  await fs.writeFile(absolutePath, buffer);
  return { relativePath: `celebrities/${name}`, absolutePath };
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  const safe = relativePath.replace(/^\/+/, "").replace(/\.\.+/g, "");
  try {
    await fs.unlink(path.join(appConfig.dataDir, safe));
  } catch {
    // ignore missing file
  }
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  const safe = relativePath.replace(/^\/+/, "").replace(/\.\.+/g, "");
  return fs.readFile(path.join(appConfig.dataDir, safe));
}

export function storagePath(relativePath: string): string {
  return path.join(appConfig.dataDir, relativePath.replace(/^\/+/, ""));
}
