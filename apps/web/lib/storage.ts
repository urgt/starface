import { getCloudflareContext } from "@opennextjs/cloudflare";

function bucket(): R2Bucket {
  return getCloudflareContext().env.STORAGE;
}

function safeKey(relativePath: string): string {
  return relativePath.replace(/^\/+/, "").replace(/\.\.+/g, "");
}

function base64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.includes(",") ? input.split(",", 2)[1] : input;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function saveUserPhoto(base64: string): Promise<{ relativePath: string }> {
  const bytes = base64ToUint8Array(base64);
  const name = `${crypto.randomUUID()}.jpg`;
  const relativePath = `users/${name}`;
  await bucket().put(relativePath, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return { relativePath };
}

export async function saveCelebrityPhoto(
  buffer: ArrayBuffer | Uint8Array,
  originalExt: string,
): Promise<{ relativePath: string }> {
  const ext = (originalExt || "jpg").replace(/^\./, "").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const name = `${crypto.randomUUID()}.${safeExt}`;
  const relativePath = `celebrities/${name}`;
  const contentType =
    safeExt === "png" ? "image/png" : safeExt === "webp" ? "image/webp" : "image/jpeg";
  await bucket().put(relativePath, buffer, {
    httpMetadata: { contentType },
  });
  return { relativePath };
}

export async function saveBrandLogo(
  buffer: ArrayBuffer | Uint8Array,
  brandId: string,
  originalExt: string,
): Promise<{ relativePath: string }> {
  const ext = (originalExt || "png").replace(/^\./, "").toLowerCase();
  const safeExt = ["png", "jpg", "jpeg", "webp", "svg"].includes(ext) ? ext : "png";
  const name = `${brandId}-${Date.now()}.${safeExt}`;
  const relativePath = `logos/${name}`;
  const contentType =
    safeExt === "svg"
      ? "image/svg+xml"
      : safeExt === "png"
        ? "image/png"
        : safeExt === "webp"
          ? "image/webp"
          : "image/jpeg";
  await bucket().put(relativePath, buffer, { httpMetadata: { contentType } });
  return { relativePath };
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  await bucket().delete(safeKey(relativePath));
}

export async function getStoredFile(relativePath: string): Promise<R2ObjectBody | null> {
  return bucket().get(safeKey(relativePath));
}

export function stripNullMeta<T extends Record<string, unknown>>(
  input: T,
): Record<string, VectorizeVectorMetadata> {
  const out: Record<string, VectorizeVectorMetadata> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}
