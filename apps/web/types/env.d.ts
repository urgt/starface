// Secrets are never in wrangler.toml, so `wrangler cf-typegen` can't infer
// them — declare them here. TS declaration merging folds these into the
// auto-generated Cloudflare.Env interface. File must stay a script (no
// imports/exports), otherwise the merge becomes module-local.

declare namespace Cloudflare {
  interface Env {
    ADMIN_USER: string;
    ADMIN_PASSWORD: string;
    CRON_SHARED_SECRET: string;
    BRAND_ANALYTICS_TOKEN_SALT: string;
    GEMINI_API_KEY: string;
    MODAL_SHARED_SECRET: string;
    MODAL_EMBED_URL: string;
  }
}
