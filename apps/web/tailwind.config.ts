import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    screens: {
      // TV-friendly breakpoints: 540p / 720p are the common logical widths
      // on embedded-browser smart TVs. Keep defaults `md/lg/xl` for admin.
      tv: "640px",
      "tv-hd": "960px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary, #FF5E3A)",
          accent: "var(--brand-accent, #111111)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-manrope)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        brand: [
          "var(--brand-font, var(--font-manrope))",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      animation: {
        "pulse-slow": "pulse 2s ease-in-out infinite",
        "scale-in": "scaleIn 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        "mosaic-scroll": "mosaicScroll 60s linear infinite",
        "glow-pulse": "glowPulse 2.4s ease-in-out infinite",
        "float-in": "floatIn 700ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scan-sweep": "scanSweep 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "flash": "flashFade 260ms ease-out both",
      },
      keyframes: {
        scaleIn: {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "60%": { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        mosaicScroll: {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-50%)" },
        },
        glowPulse: {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "1" },
        },
        floatIn: {
          "0%": { transform: "translateY(24px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scanSweep: {
          "0%": { transform: "translateY(-120%)" },
          "100%": { transform: "translateY(420%)" },
        },
        flashFade: {
          "0%": { opacity: "0.9" },
          "100%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
