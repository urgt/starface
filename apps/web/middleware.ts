import { NextRequest, NextResponse } from "next/server";

const REALM = 'Basic realm="starface-admin"';

export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  const needsAuth = p.startsWith("/admin") || p.startsWith("/api/admin");
  if (!needsAuth) return NextResponse.next();

  const adminUser = process.env.ADMIN_USER ?? "admin";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "change-me";
  const expected = "Basic " + btoa(`${adminUser}:${adminPassword}`);

  const header = req.headers.get("authorization");
  if (header === expected) return NextResponse.next();

  const isPrefetch =
    req.headers.get("next-router-prefetch") === "1" ||
    req.headers.get("purpose") === "prefetch" ||
    req.headers.get("sec-purpose") === "prefetch";

  return new NextResponse("Authentication required", {
    status: 401,
    headers: isPrefetch ? {} : { "WWW-Authenticate": REALM },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
