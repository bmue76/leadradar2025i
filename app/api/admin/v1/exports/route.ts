// app/api/admin/v1/exports/route.ts
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { httpError, isHttpError, validateQuery } from "@/lib/http";

export const runtime = "nodejs";

// Status comes from Prisma, includes QUEUED
const ExportListQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).optional().default(20),
  page: z.coerce.number().int().min(1).optional().default(1),

  // optional filters
  formId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]).optional(),
});

type ExportListItem = {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  createdAt: string;
  updatedAt: string;
  formId: string | null;
  groupId: string | null;
  canDownload: boolean;
  downloadUrl: string | null;
};

export async function GET(req: Request) {
  try {
    // Your requireTenantContext returns TenantResult -> ctx is nested
    const tr: any = await requireTenantContext(req);
    const ctx = tr?.ctx ?? tr;
    const tenantId: string | undefined = ctx?.tenantId;

    if (!tenantId) {
      return jsonError(req, 401, "Unauthorized", "UNAUTHORIZED");
    }

    const q = validateQuery(req, ExportListQuerySchema);
    const take = q.take ?? 20;
    const page = q.page ?? 1;
    const skip = (page - 1) * take;

    // Tenant-scoped only (ExportJob has no ownerId in your schema)
    const where: any = { tenantId };
    if (q.formId) where.formId = q.formId;
    if (q.groupId) where.groupId = q.groupId;
    if (q.status) where.status = q.status;

    const [total, jobs] = await prisma.$transaction([
      prisma.exportJob.count({ where }),
      prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    const items: ExportListItem[] = jobs.map((j: any) => {
      const canDownload = j.status === "DONE" && Boolean(j.resultStorageKey);
      return {
        id: j.id,
        status: j.status,
        createdAt: new Date(j.createdAt).toISOString(),
        updatedAt: new Date(j.updatedAt).toISOString(),
        formId: j.formId ?? null,
        groupId: j.groupId ?? null,
        canDownload,
        downloadUrl: canDownload ? `/api/admin/v1/exports/${j.id}/download` : null,
      };
    });

    return jsonOk(req, {
      items,
      meta: {
        page,
        take,
        total,
        hasMore: skip + items.length < total,
      },
    });
  } catch (err: any) {
    if (isHttpError(err)) {
      return jsonError(req, err.status, err.message, err.code, err.details);
    }
    return jsonError(req, 500, "Internal Server Error", "INTERNAL");
  }
}
