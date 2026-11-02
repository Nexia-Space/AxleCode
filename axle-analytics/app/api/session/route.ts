import { NextResponse } from "next/server";

import { ADMIN_EMAIL, readAdminIdentity } from "@/lib/auth";

export async function POST(request: Request) {
  void request;
  const identity = await readAdminIdentity();
  if (identity.userId === null) {
    return NextResponse.json({ error: `Sign in with Google using ${ADMIN_EMAIL}.` }, { status: 401 });
  }
  return NextResponse.json({ ok: true, email: identity.email });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
