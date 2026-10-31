import { NextResponse } from "next/server";

import { getDb, recordEvent, type EventInput } from "@/lib/db";

const ALLOWED_SOURCES = new Set(["site", "app", "edge"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS });
  }
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Event must be an object." }, { status: 400, headers: CORS });
  }

  const raw = body as Record<string, unknown>;
  const visitorId = asString(raw.visitorId);
  const sessionId = asString(raw.sessionId);
  const source = asString(raw.source);
  const kind = asString(raw.kind);
  const path = asString(raw.path);
  const at = asNumber(raw.at);

  if (
    !visitorId ||
    !sessionId ||
    !source ||
    !kind ||
    !path ||
    at === undefined ||
    !ALLOWED_SOURCES.has(source)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid event fields (visitorId, sessionId, source, kind, path, at)." },
      { status: 400, headers: CORS },
    );
  }

  const input: EventInput = {
    visitorId,
    sessionId,
    source,
    kind,
    path,
    at,
    label: asString(raw.label),
    engagedMs: asNumber(raw.engagedMs),
    downloadId: asString(raw.downloadId),
    requestId: asString(raw.requestId),
    environmentId: asString(raw.environmentId),
    threadId: asString(raw.threadId),
    turnId: asString(raw.turnId),
    platform: asString(raw.platform),
    release: asString(raw.release),
    file: asString(raw.file),
    outcome: asString(raw.outcome),
    referrer: asString(raw.referrer),
    browser: asString(raw.browser),
    os: asString(raw.os),
    device: asString(raw.device),
    country: asString(raw.country),
    colo: asString(raw.colo),
    language: asString(raw.language),
    timezone: asString(raw.timezone),
    viewport: asString(raw.viewport),
    status: asNumber(raw.status),
    model: asString(raw.model),
    provider: asString(raw.provider),
    inputTokens: asNumber(raw.inputTokens),
    cachedInputTokens: asNumber(raw.cachedInputTokens),
    outputTokens: asNumber(raw.outputTokens),
    reasoningOutputTokens: asNumber(raw.reasoningOutputTokens),
    totalTokens: asNumber(raw.totalTokens),
    toolUses: asNumber(raw.toolUses),
    costUsd: asNumber(raw.costUsd),
  };

  try {
    recordEvent(getDb(), input);
  } catch (error) {
    console.error("Failed to record analytics event", error);
    return NextResponse.json({ error: "Failed to record event." }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}