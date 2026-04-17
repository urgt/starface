import { getLlmConfig, maskApiKey } from "@/lib/settings";
import { ImportSection } from "./ImportSection";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await getLlmConfig();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm
        initial={{
          baseUrl: cfg.baseUrl,
          apiKeyMasked: maskApiKey(cfg.apiKey),
          model: cfg.model,
        }}
      />
      <ImportSection />
    </div>
  );
}
