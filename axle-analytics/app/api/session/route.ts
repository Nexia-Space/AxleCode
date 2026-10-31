import { NextResponse } from "next/server";

import { ADMIN_COOKIE, readAdminToken, timingSafeEqual } from "@/lib/auth";

export async function POST(request: Request) {
  const expected = readAdminToken();
  if (!expected) {
    return NextResponse.json(
      { error: "Server is missing ANALYTICS_DASHBOARD_TOKEN." },
      { status: 503 },
    );
  }

  let token = "";
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === "object" && "token" in body) {
      const value = (body as { token: unknown }).token;
      if (typeof value === "string") token = value.trim();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: "Incorrect token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}