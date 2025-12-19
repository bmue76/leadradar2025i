// app/api/admin/v1/recipients/[id]/entries/[entryId]/route.ts
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

function getIdsFromCtxOrUrl(
  req: Request,
  ctx?: { params?: { id?: string; entryId?: string } }
): { recipientListId: string; entryId: string } {
  const rid = ctx?.params?.id?.trim() || "";
  const eid = ctx?.params?.entryId?.trim() || "";

  if (rid && eid) return { recipientListId: rid, entryId: eid };

  // Fallback: /api/admin/v1/recipients/{id}/entries/{entryId}
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("recipients");
    const listId = idx >= 0 && parts[idx + 1] ? String(parts[idx + 1]).trim() : "";
    const eIdx = parts.lastIndexOf("entries");
    const entryId = eIdx >= 0 && parts[eIdx + 1] ? String(parts[eIdx + 1]).trim() : "";
    return { recipientListId: listId, entryId };
  } catch {
    return { recipientListId: "", entryId: "" };
  }
}

export async function DELETE(
  req: Request,
  ctx: { params?: { id?: string; entryId?: string } }
) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const { recipientListId, entryId } = getIdsFromCtxOrUrl(req, ctx);
  if (!recipientListId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing recipient list id.");
  }
  if (!entryId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing entry id.");
  }

  // leak-safe list validation
  const list = await prisma.recipientList.findFirst({
    where: { id: recipientListId, tenantId: scoped.ctx.tenantId },
    select: { id: true },
  });
  if (!list) return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");

  const entry = await prisma.recipientListEntry.findFirst({
    where: {
      id: entryId,
      tenantId: scoped.ctx.tenantId,
      recipientListId: list.id,
    },
    select: { id: true, email: true },
  });

  if (!entry) return jsonError(req, 404, "NOT_FOUND", "Entry not found.");

  await prisma.recipientListEntry.delete({ where: { id: entry.id } });

  // Audit (best effort)
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: scoped.ctx.tenantId,
        actorType: "USER",
        actorUserId: scoped.ctx.user.id,
        action: "RECIPIENT_ENTRY_DELETED",
        entityType: "RECIPIENT_LIST_ENTRY",
        entityId: entry.id,
        meta: { recipientListId: list.id, email: entry.email },
      },
    });
  } catch {
    // ignore
  }

  return jsonOk(req, { id: entry.id, deleted: true });
}
