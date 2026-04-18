import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { saveBrandLogo } from "@/lib/storage";
import { BrandFormFields } from "../BrandFormFields";

export const dynamic = "force-dynamic";

export default async function EditBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, id))
    .limit(1);

  if (!brand) notFound();

  async function updateBrand(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("name required");

    let logoPath = brand.logoPath;
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

    await db
      .update(schema.brands)
      .set({
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
        active: formData.get("active") === "true",
      })
      .where(eq(schema.brands.id, id));

    redirect("/admin/brands");
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Edit: {brand.name}</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/kiosk?brand=${brand.id}`}
            target="_blank"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium"
          >
            Open kiosk ↗
          </Link>
          <Link
            href={`/demo/result?brand=${brand.id}`}
            target="_blank"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium"
          >
            Preview result ↗
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
        <span className="font-mono">ID: {brand.id}</span> ·{" "}
        <span className="font-mono">token: {brand.analyticsToken.slice(0, 8)}…</span>
      </div>

      <form action={updateBrand} className="space-y-4">
        <BrandFormFields mode="edit" defaults={brand} />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-white"
        >
          Save
        </button>
      </form>
    </div>
  );
}
