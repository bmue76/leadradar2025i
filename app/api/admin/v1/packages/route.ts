// app/api/admin/v1/packages/route.ts
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET(req: NextRequest) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  try {
    const items = await prisma.package.findMany({
      orderBy: [{ status: "asc" }, { durationDays: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        durationDays: true,
        priceCents: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk(req, { items });
  } catch (e) {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to load packages");
  }
}
