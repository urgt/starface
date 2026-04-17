"use client";

import { FONT_FAMILIES } from "@/lib/i18n";

type BrandFormValues = {
  name?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  bgGradientFrom?: string | null;
  bgGradientTo?: string | null;
  headlineUz?: string | null;
  headlineRu?: string | null;
  subtitleUz?: string | null;
  subtitleRu?: string | null;
  idleTextUz?: string | null;
  idleTextRu?: string | null;
  ctaLabelUz?: string | null;
  ctaLabelRu?: string | null;
  ctaUrl?: string | null;
  fontFamily?: string | null;
  promoCode?: string | null;
  promoTextUz?: string | null;
  promoTextRu?: string | null;
  logoPath?: string | null;
};

type Props = {
  mode: "create" | "edit";
  defaults?: BrandFormValues;
};

export function BrandFormFields({ mode, defaults = {} }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Identity">
        <Field label="Name" name="name" required defaultValue={defaults.name ?? ""} />
        <FileField
          label="Logo"
          name="logo"
          hint={defaults.logoPath ? `Current: ${defaults.logoPath}` : undefined}
        />
      </Section>

      <Section title="Colors & Theme">
        <div className="grid grid-cols-2 gap-4">
          <ColorField
            label="Primary color"
            name="primaryColor"
            defaultValue={defaults.primaryColor ?? "#FF5E3A"}
          />
          <ColorField
            label="Accent color"
            name="accentColor"
            defaultValue={defaults.accentColor ?? "#111111"}
          />
          <ColorField
            label="Background gradient (top)"
            name="bgGradientFrom"
            defaultValue={defaults.bgGradientFrom ?? "#1a0b2e"}
          />
          <ColorField
            label="Background gradient (bottom)"
            name="bgGradientTo"
            defaultValue={defaults.bgGradientTo ?? "#0a0a0a"}
          />
        </div>
        <SelectField
          label="Font family"
          name="fontFamily"
          defaultValue={defaults.fontFamily ?? "manrope"}
          options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
        />
      </Section>

      <Section title="Idle screen copy">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Headline (UZ)" name="headlineUz" defaultValue={defaults.headlineUz ?? ""} />
          <Field label="Headline (RU)" name="headlineRu" defaultValue={defaults.headlineRu ?? ""} />
          <Field label="Subtitle (UZ)" name="subtitleUz" defaultValue={defaults.subtitleUz ?? ""} />
          <Field label="Subtitle (RU)" name="subtitleRu" defaultValue={defaults.subtitleRu ?? ""} />
          <Field
            label="Idle text — legacy (UZ)"
            name="idleTextUz"
            defaultValue={defaults.idleTextUz ?? ""}
          />
          <Field
            label="Idle text — legacy (RU)"
            name="idleTextRu"
            defaultValue={defaults.idleTextRu ?? ""}
          />
        </div>
      </Section>

      <Section title="Result page CTA">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="CTA label (UZ)"
            name="ctaLabelUz"
            defaultValue={defaults.ctaLabelUz ?? ""}
          />
          <Field
            label="CTA label (RU)"
            name="ctaLabelRu"
            defaultValue={defaults.ctaLabelRu ?? ""}
          />
        </div>
        <Field
          label="CTA URL"
          name="ctaUrl"
          placeholder="https://brand.example/product"
          defaultValue={defaults.ctaUrl ?? ""}
        />
      </Section>

      <Section title="Promo">
        <Field label="Promo code" name="promoCode" defaultValue={defaults.promoCode ?? ""} />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Promo text (UZ)"
            name="promoTextUz"
            defaultValue={defaults.promoTextUz ?? ""}
          />
          <Field
            label="Promo text (RU)"
            name="promoTextRu"
            defaultValue={defaults.promoTextRu ?? ""}
          />
        </div>
      </Section>

      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" value="true" defaultChecked />
          Active
        </label>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <legend className="px-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
      />
    </label>
  );
}

function ColorField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          name={`${name}__picker`}
          defaultValue={defaultValue}
          className="h-10 w-14 rounded border border-neutral-300 bg-white"
          onChange={(e) => {
            const input = e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
              `input[name="${name}"]`,
            );
            if (input) input.value = e.currentTarget.value;
          }}
        />
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs"
        />
      </div>
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileField({
  label,
  name,
  hint,
}: {
  label: string;
  name: string;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input type="file" name={name} accept="image/*" />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}
