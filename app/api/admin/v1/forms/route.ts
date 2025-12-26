// app/api/admin/v1/forms/route.ts
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";
import { isHttpError } from "@/lib/http";

export const runtime = "nodejs";

type FormListItem = {
  id: string;
  name: string;
  status: string;
  groupId: string | null;
  templateId: string | null;
  updatedAt: string; // ISO
};

function handleError(req: Request, err: unknown, fallbackMessage: string) {
  if (isHttpError(err)) {
    return jsonError(req, err.status, err.code, err.message, err.details);
  }
  return jsonError(req, 500, "INTERNAL_ERROR", fallbackMessage);
}

export async function GET(req: NextRequest) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  try {
    const forms = await prisma.form.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        groupId: true,
        templateId: true,
        updatedAt: true,
      },
    });

    const items: FormListItem[] = forms.map((f) => ({
      id: f.id,
      name: f.name,
      status: String(f.status),
      groupId: f.groupId ?? null,
      templateId: f.templateId ?? null,
      updatedAt: f.updatedAt.toISOString(),
    }));

    return jsonOk(req, { items });
  } catch (err) {
    return handleError(req, err, "Failed to load forms");
  }
}
