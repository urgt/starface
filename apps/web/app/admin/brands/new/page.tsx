import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

async function createBrand(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("id and name required");

  let logoPath: string | null = null;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const dir = path.join(appConfig.dataDir, "logos");
    await fs.mkdir(dir, { recursive: true });
    const ext = (logo.name.split(".").pop() || "png").toLowerCase();
    const filename = `${id}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(await logo.arrayBuffer());
    await fs.writeFile(path.join(dir, filename), buffer);
    logoPath = `logos/${filename}`;
  }

  await db.insert(schema.brands).values({
    id,
    name,
    logoPath,
    primaryColor: (String(formData.get("primaryColor") ?? "")) || "#FF5E3A",
    accentColor: (String(formData.get("accentColor") ?? "")) || "#111111",
    idleTextUz: (String(formData.get("idleTextUz") ?? "")) || null,
    idleTextRu: (String(formData.get("idleTextRu") ?? "")) || null,
    promoCode: (String(formData.get("promoCode") ?? "")) || null,
    promoTextUz: (String(formData.get("promoTextUz") ?? "")) || null,
    promoTextRu: (String(formData.get("promoTextRu") ?? "")) || null,
    analyticsToken: randomBytes(24).toString("hex"),
    active: true,
  });

  redirect("/admin/brands");
}

export default function NewBrandPage() {
  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">New brand</h1>
      <form action={createBrand} encType="multipart/form-data" className="space-y-4">
        <Field label="ID (slug)" name="id" required placeholder="mediapark" />
        <Field label="Name" name="name" required placeholder="Mediapark" />
        <Field label="Primary color" name="primaryColor" placeholder="#FF5E3A" />
        <Field label="Accent color" name="accentColor" placeholder="#111111" />
        <Field label="Idle text (UZ)" name="idleTextUz" />
        <Field label="Idle text (RU)" name="idleTextRu" />
        <Field label="Promo code" name="promoCode" />
        <Field label="Promo text (UZ)" name="promoTextUz" />
        <Field label="Promo text (RU)" name="promoTextRu" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Logo</span>
          <input type="file" name="logo" accept="image/*" />
        </label>
        <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-white">
          Create
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
