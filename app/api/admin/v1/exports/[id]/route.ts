// app/api/admin/v1/exports/[id]/route.ts
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { httpError, isHttpError } from "@/lib/http";

export const runtime = "nodejs";

type ExportStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

type ExportDetail = {
  id: string;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  formId: string | null;
  groupId: string | null;

  canDownload: boolean;
  downloadUrl: string | null;

  errorMessage: string | null;
};

export async function GET(req: Request, routeCtx: { params: { id: string } }) {
  try {
    const tr: any = await requireTenantContext(req);
    const ctx = tr?.ctx ?? tr;
    const tenantId: string | undefined = ctx?.tenantId;

    if (!tenantId) {
      return jsonError(req, 401, "Unauthorized", "UNAUTHORIZED");
    }

    const id = routeCtx?.params?.id;
    if (!id || typeof id !== "string") {
      throw httpError(400, "Missing export id", "BAD_REQUEST");
    }

    // Tenant-scoped lookup (no ownerId in your ExportJob schema)
    const job: any = await prisma.exportJob.findFirst({
      where: { id, tenantId },
    });

    if (!job) {
      throw httpError(404, "Export not found", "NOT_FOUND");
    }

    const canDownload = job.status === "DONE" && Boolean(job.resultStorageKey);

    const data: ExportDetail = {
      id: job.id,
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      formId: job.formId ?? null,
      groupId: job.groupId ?? null,
      canDownload,
      downloadUrl: canDownload ? `/api/admin/v1/exports/${job.id}/download` : null,
      errorMessage: job.errorMessage ?? null,
    };

    return jsonOk(req, data);
  } catch (err: any) {
    if (isHttpError(err)) {
      return jsonError(req, err.status, err.message, err.code, err.details);
    }
    return jsonError(req, 500, "Internal Server Error", "INTERNAL");
  }
}
