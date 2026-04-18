import { getLlmConfig, maskApiKey } from "@/lib/settings";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await getLlmConfig();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-sm text-neutral-500">
        LLM is used only by the local enroll/description scripts (Ollama or LM Studio on the
        operator&apos;s machine). The production worker does not call the LLM — these values are
        stored for convenience so scripts can read them from a shared source.
      </p>
      <SettingsForm
        initial={{
          baseUrl: cfg.baseUrl,
          apiKeyMasked: maskApiKey(cfg.apiKey),
          model: cfg.model,
        }}
      />
    </div>
  );
}
