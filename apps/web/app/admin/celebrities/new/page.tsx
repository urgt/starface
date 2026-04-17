import { redirect } from "next/navigation";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { appConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { embedImage, MlError } from "@/lib/ml-client";

export const dynamic = "force-dynamic";

async function enroll(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const nameRu = String(formData.get("nameRu") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || null;
  const descUz = String(formData.get("descriptionUz") ?? "").trim() || null;
  const descRu = String(formData.get("descriptionRu") ?? "").trim() || null;
  const photo = formData.get("photo");
  if (!name || !(photo instanceof File) || photo.size === 0) {
    throw new Error("name + photo required");
  }

  const buffer = Buffer.from(await photo.arrayBuffer());
  const base64 = buffer.toString("base64");

  let embedding: number[];
  let faceQuality: string;
  let detScore: number;
  try {
    const result = await embedImage(base64, true);
    embedding = result.embedding;
    faceQuality = result.face_quality;
    detScore = result.det_score;
  } catch (e) {
    const reason = e instanceof MlError ? e.code : "internal";
    throw new Error(`embed_failed: ${reason}`);
  }

  const dir = path.join(appConfig.dataDir, "celebrities");
  await fs.mkdir(dir, { recursive: true });
  const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
  const filename = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);

  const vecLiteral = `[${embedding.map((v) => v.toFixed(8)).join(",")}]`;

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO celebrities (name, name_ru, description_uz, description_ru, category)
    VALUES (${name}, ${nameRu || null}, ${descUz}, ${descRu}, ${category})
    RETURNING id
  `);
  const celebrityId = rows[0]?.id;
  if (!celebrityId) throw new Error("insert_failed");

  await db.execute(sql`
    INSERT INTO celebrity_photos (celebrity_id, photo_path, embedding, is_primary, face_quality, det_score)
    VALUES (${celebrityId}, ${`celebrities/${filename}`}, ${vecLiteral}::vector, true, ${faceQuality}, ${detScore})
  `);

  redirect("/admin/celebrities");
}

export default function NewCelebrityPage() {
  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">Enroll celebrity</h1>
      <form action={enroll} encType="multipart/form-data" className="space-y-4">
        <Field label="Name (UZ / Latin)" name="name" required placeholder="Sevara Nazarxon" />
        <Field label="Name (RU)" name="nameRu" placeholder="Севара Назархан" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select name="category" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2">
            <option value="uz">uz</option>
            <option value="cis">cis</option>
            <option value="world">world</option>
          </select>
        </label>
        <Field label="Description (UZ)" name="descriptionUz" />
        <Field label="Description (RU)" name="descriptionRu" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Photo (single clean face)</span>
          <input type="file" name="photo" accept="image/*" required />
        </label>
        <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-white">
          Enroll
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
      />
    </label>
  );
}
