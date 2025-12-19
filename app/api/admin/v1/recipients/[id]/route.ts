import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

type RecipientListDto = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function getIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) return xff.split(",")[0]?.trim() || null;
  const xri = req.headers.get("x-real-ip")?.trim();
  return xri || null;
}

function getUserAgent(req: Request): string | null {
  const ua = req.headers.get("user-agent")?.trim();
  return ua || null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = params.id?.trim();
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing recipient list id.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body.");
  }

  const hasName = Object.prototype.hasOwnProperty.call(body ?? {}, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body ?? {}, "description");
  const hasIsActive = Object.prototype.hasOwnProperty.call(body ?? {}, "isActive");

  if (!hasName && !hasDescription && !hasIsActive) {
    return jsonError(
      req,
      400,
      "INVALID_REQUEST",
      'Provide at least one of: "name", "description", "isActive".'
    );
  }

  const existing = await prisma.recipientList.findFirst({
    where: { id, tenantId: scoped.ctx.tenantId },
    select: { id: true },
  });
  if (!existing) {
    return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");
  }

  let nameData: string | undefined = undefined;
  if (hasName) {
    const nameRaw = body?.name;
    if (!isNonEmptyString(nameRaw)) {
      return jsonError(req, 400, "INVALID_REQUEST", '"name" must be a non-empty string.');
    }
    nameData = nameRaw.trim();
  }

  let descriptionData: string | null | undefined = undefined;
  if (hasDescription) {
    const descRaw = body?.description;
    if (descRaw === null) {
      descriptionData = null;
    } else if (typeof descRaw === "string") {
      const t = descRaw.trim();
      descriptionData = t.length > 0 ? t : null;
    } else {
      return jsonError(req, 400, "INVALID_REQUEST", '"description" must be string or null.');
    }
  }

  let isActiveData: boolean | undefined = undefined;
  if (hasIsActive) {
    const v = body?.isActive;
    if (typeof v !== "boolean") {
      return jsonError(req, 400, "INVALID_REQUEST", '"isActive" must be boolean.');
    }
    isActiveData = v;
  }

  const ip = getIp(req);
  const userAgent = getUserAgent(req);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.recipientList.update({
        where: { id: existing.id },
        data: {
          ...(nameData === undefined ? {} : { name: nameData }),
          ...(descriptionData === undefined ? {} : { description: descriptionData }),
          ...(isActiveData === undefined ? {} : { isActive: isActiveData }),
        },
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "RECIPIENT_LIST_UPDATED",
          entityType: "RECIPIENT_LIST",
          entityId: row.id,
          ip,
          userAgent,
          meta: {
            changed: {
              ...(nameData === undefined ? {} : { name: true }),
              ...(descriptionData === undefined ? {} : { description: true }),
              ...(isActiveData === undefined ? {} : { isActive: true }),
            },
          },
        },
      });

      return row;
    });

    const dto: RecipientListDto = {
      id: updated.id,
      name: updated.name,
      description: updated.description ?? null,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };

    return jsonOk(req, dto);
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return jsonError(
          req,
          409,
          "DUPLICATE",
          "A recipient list with this name already exists."
        );
      }
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to update recipient list.");
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = params.id?.trim();
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing recipient list id.");

  const ip = getIp(req);
  const userAgent = getUserAgent(req);

  const existing = await prisma.recipientList.findFirst({
    where: { id, tenantId: scoped.ctx.tenantId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.recipientList.delete({
        where: { id: existing.id },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "RECIPIENT_LIST_DELETED",
          entityType: "RECIPIENT_LIST",
          entityId: existing.id,
          ip,
          userAgent,
          meta: { name: existing.name },
        },
      });
    });

    return jsonOk(req, { id: existing.id, deleted: true });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to delete recipient list.");
  }
}