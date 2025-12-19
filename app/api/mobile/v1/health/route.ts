import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return jsonError(
      req,
      500,
      "CONFIG_MISSING",
      "Missing required env var: DATABASE_URL",
      { missing: ["DATABASE_URL"] }
    );
  }

  const data = {
    status: "ok" as const,
    scope: "mobile" as const,
    nowIso: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    vercelId: req.headers.get("x-vercel-id") ?? null,
  };

  return jsonOk(req, data);
}
