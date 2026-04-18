import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

async function enroll(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const nameRu = String(formData.get("nameRu") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;
  const descUz = String(formData.get("descriptionUz") ?? "").trim() || null;
  const descRu = String(formData.get("descriptionRu") ?? "").trim() || null;
  if (!name) throw new Error("name_required");

  const [row] = await db
    .insert(schema.celebrities)
    .values({ name, nameRu, category, descriptionUz: descUz, descriptionRu: descRu })
    .returning({ id: schema.celebrities.id });

  redirect(`/admin/celebrities?focus=${row.id}`);
}

export default function NewCelebrityPage() {
  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">Enroll celebrity</h1>
      <p className="text-sm text-neutral-500">
        This form creates the celebrity record only. After saving, open the celebrity in the list
        and upload photos — embeddings are computed in the browser and stored in Vectorize.
      </p>
      <form action={enroll} className="space-y-4">
        <Field label="Name (UZ / Latin)" name="name" required placeholder="Sevara Nazarxon" />
        <Field label="Name (RU)" name="nameRu" placeholder="Севара Назархан" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select
            name="category"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
          >
            <option value="uz">uz</option>
            <option value="cis">cis</option>
            <option value="world">world</option>
          </select>
        </label>
        <Field label="Description (UZ)" name="descriptionUz" />
        <Field label="Description (RU)" name="descriptionRu" />
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
