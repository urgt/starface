import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { saveBrandLogo } from "@/lib/storage";
import { BrandFormFields } from "../BrandFormFields";

export const dynamic = "force-dynamic";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function createBrand(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("id and name required");

  let logoPath: string | null = null;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const ext = logo.name.split(".").pop() || "png";
    const buffer = await logo.arrayBuffer();
    const saved = await saveBrandLogo(buffer, id, ext);
    logoPath = saved.relativePath;
  }

  const s = (key: string): string | null => {
    const v = String(formData.get(key) ?? "").trim();
    return v.length ? v : null;
  };

  await db.insert(schema.brands).values({
    id,
    name,
    logoPath,
    primaryColor: s("primaryColor") ?? "#FF5E3A",
    accentColor: s("accentColor") ?? "#111111",
    bgGradientFrom: s("bgGradientFrom") ?? "#1a0b2e",
    bgGradientTo: s("bgGradientTo") ?? "#0a0a0a",
    headlineUz: s("headlineUz"),
    headlineRu: s("headlineRu"),
    subtitleUz: s("subtitleUz"),
    subtitleRu: s("subtitleRu"),
    idleTextUz: s("idleTextUz"),
    idleTextRu: s("idleTextRu"),
    ctaLabelUz: s("ctaLabelUz"),
    ctaLabelRu: s("ctaLabelRu"),
    ctaUrl: s("ctaUrl"),
    fontFamily: s("fontFamily"),
    promoCode: s("promoCode"),
    promoTextUz: s("promoTextUz"),
    promoTextRu: s("promoTextRu"),
    analyticsToken: randomHex(24),
    active: true,
  });

  redirect("/admin/brands");
}

export default function NewBrandPage() {
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">New brand</h1>
      <form action={createBrand} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">ID (slug)</span>
          <input
            type="text"
            name="id"
            required
            placeholder="mediapark"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
          />
        </label>
        <BrandFormFields mode="create" />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-white"
        >
          Create
        </button>
      </form>
    </div>
  );
}
