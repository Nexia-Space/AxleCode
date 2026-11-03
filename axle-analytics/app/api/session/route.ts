import { NextResponse } from "next/server";

import { ADMIN_COOKIE, authenticateAdmin, createAdminSession, isAdminConfigured } from "@/lib/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const username = body !== null && typeof body === "object" && "username" in body && typeof body.username === "string" ? body.username : "";
  const passcode = body !== null && typeof body === "object" && "passcode" in body && typeof body.passcode === "string" ? body.passcode : "";
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Admin login is not configured on this deployment." }, { status: 503 });
  }
  if (!authenticateAdmin(username, passcode)) return NextResponse.json({ error: "Incorrect username or passcode." }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, createAdminSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
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
