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

export async function GET(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const rows = await prisma.recipientList.findMany({
    where: { tenantId: scoped.ctx.tenantId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const items: RecipientListDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return jsonOk(req, { items });
}

export async function POST(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body.");
  }

  const nameRaw = body?.name;
  const descRaw = body?.description;
  const isActiveRaw = body?.isActive;

  if (!isNonEmptyString(nameRaw)) {
    return jsonError(req, 400, "INVALID_REQUEST", '"name" is required.');
  }

  const name = nameRaw.trim();
  const description =
    typeof descRaw === "string" && descRaw.trim().length > 0 ? descRaw.trim() : null;

  let isActive = true;
  if (typeof isActiveRaw === "boolean") isActive = isActiveRaw;

  const ip = getIp(req);
  const userAgent = getUserAgent(req);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const list = await tx.recipientList.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          name,
          description,
          isActive,
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
          action: "RECIPIENT_LIST_CREATED",
          entityType: "RECIPIENT_LIST",
          entityId: list.id,
          ip,
          userAgent,
          meta: { name: list.name, isActive: list.isActive },
        },
      });

      return list;
    });

    const dto: RecipientListDto = {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };

    return jsonOk(req, dto, { status: 201 });
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
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to create recipient list.");
  }
}