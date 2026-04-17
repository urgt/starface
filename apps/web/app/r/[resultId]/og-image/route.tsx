import { ImageResponse } from "next/og";
import { eq, sql } from "drizzle-orm";

import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { brandThemeFromRow, DEFAULT_BRAND_THEME } from "@/lib/brand-theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 } as const;

/**
 * Server-rendered composite image used as `og:image` on the share page.
 * Two portraits side-by-side, the similarity % under them, and a brand-tinted
 * gradient backdrop. Next.js renders this through @vercel/satori so only inline
 * styles + plain <img> tags work — no Tailwind.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ resultId: string }> },
) {
  const { resultId } = await params;

  const rows = await db.execute<{
    similarity: number;
    user_photo_path: string;
    brand_id: string | null;
    celebrity_name: string | null;
    celebrity_name_ru: string | null;
    celebrity_photo_path: string | null;
  }>(sql`
    SELECT m.similarity, m.user_photo_path, m.brand_id,
           c.name AS celebrity_name,
           c.name_ru AS celebrity_name_ru,
           cp.photo_path AS celebrity_photo_path
      FROM match_results m
      LEFT JOIN celebrities c ON c.id = m.celebrity_id
      LEFT JOIN celebrity_photos cp ON cp.id = m.celebrity_photo_id
      WHERE m.id = ${resultId}
      LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  let brand = DEFAULT_BRAND_THEME;
  if (row.brand_id) {
    const [b] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, row.brand_id))
      .limit(1);
    if (b) brand = brandThemeFromRow(b);
  }

  const userImg = `${appConfig.appUrl}/api/files/${row.user_photo_path}`;
  const celebImg = row.celebrity_photo_path
    ? `${appConfig.appUrl}/api/files/${row.celebrity_photo_path}`
    : null;
  const celebName = row.celebrity_name_ru || row.celebrity_name || "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${brand.bgGradientFrom} 0%, ${brand.bgGradientTo} 100%)`,
          color: "white",
          fontFamily: "system-ui, sans-serif",
          padding: 48,
        }}
      >
        <div style={{ display: "flex", flex: 1, gap: 32 }}>
          <PortraitPanel src={userImg} label="Siz" mirror primary={brand.primaryColor} />
          <PortraitPanel src={celebImg} label={celebName} primary={brand.primaryColor} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                fontSize: 168,
                fontWeight: 900,
                color: brand.primaryColor,
                lineHeight: 1,
                letterSpacing: -6,
              }}
            >
              <span>{row.similarity}</span>
              <span style={{ fontSize: 72 }}>%</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", paddingBottom: 28 }}>
              <span style={{ fontSize: 18, textTransform: "uppercase", letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>
                similarity
              </span>
              <span style={{ fontSize: 42, fontWeight: 700, marginTop: 4 }}>{celebName}</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 2,
            }}
          >
            STARFACE · {brand.id.toUpperCase()}
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
    },
  );
}

function PortraitPanel({
  src,
  label,
  mirror,
  primary,
}: {
  src: string | null;
  label: string;
  mirror?: boolean;
  primary: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        borderRadius: 28,
        overflow: "hidden",
        border: `1px solid ${primary}30`,
        background: "rgba(0,0,0,0.5)",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={src}
          width="100%"
          height="100%"
          style={
            mirror
              ? { objectFit: "cover", transform: "scaleX(-1)" }
              : { objectFit: "cover" }
          }
        />
      ) : (
        <div style={{ flex: 1 }} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          padding: 20,
          background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent 60%)",
        }}
      >
        <span style={{ fontSize: 30, fontWeight: 700, color: "white" }}>{label}</span>
      </div>
    </div>
  );
}
