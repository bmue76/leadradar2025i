// app/api/admin/v1/exports/csv/route.ts
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseBool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (t === "1" || t === "true" || t === "yes" || t === "ja") return true;
  if (t === "0" || t === "false" || t === "no" || t === "nein") return false;
  return null;
}

function parseFrom(v: unknown): Date | null {
  if (!isNonEmptyString(v)) return null;
  const t = v.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTo(v: unknown): { lt?: Date; lte?: Date } | null {
  if (!isNonEmptyString(v)) return null;
  const t = v.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const start = new Date(`${t}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 1);
    return { lt: next };
  }

  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return { lte: d };
}

function deChHumanDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";

  // Regel: DD.MMMM.YYYY (ohne Spaces)
  return `${day}.${month}.${year}`;
}

function yesNo(v: unknown): string {
  const b =
    v === true
      ? true
      : v === false
        ? false
        : typeof v === "string"
          ? ["1", "true", "yes", "ja"].includes(v.trim().toLowerCase())
          : Boolean(v);

  return b ? "ja" : "nein";
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(";") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeMultiSelect(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
      .filter(Boolean)
      .join("/");
  }
  if (typeof v === "string") return v.trim();
  return "";
}

function valueToStringForFieldType(fieldType: string, v: unknown): { human: string; iso?: string } {
  switch (fieldType) {
    case "CHECKBOX":
      return { human: yesNo(v) };

    case "MULTISELECT":
      return { human: normalizeMultiSelect(v) };

    case "DATE":
    case "DATETIME": {
      if (typeof v !== "string" || !v.trim()) return { human: "", iso: "" };
      const d = new Date(v.trim());
      if (Number.isNaN(d.getTime())) return { human: "", iso: "" };
      return { human: deChHumanDate(d), iso: d.toISOString() };
    }

    default:
      if (v === null || v === undefined) return { human: "" };
      if (typeof v === "string") return { human: v.trim() };
      if (typeof v === "number" && Number.isFinite(v)) return { human: String(v) };
      if (typeof v === "boolean") return { human: yesNo(v) };
      return { human: String(v) };
  }
}

function safeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export async function POST(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "BAD_JSON", "Invalid JSON body.");
  }
  if (!isRecord(body)) {
    return jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.");
  }

  const formId = isNonEmptyString(body.formId) ? body.formId.trim() : "";
  if (!formId) {
    return jsonError(req, 400, "FORM_ID_REQUIRED", "formId is required.");
  }

  const groupId = isNonEmptyString(body.groupId) ? body.groupId.trim() : null;

  const includeDeletedRaw = parseBool((body as any).includeDeleted);
  if ((body as any).includeDeleted !== undefined && includeDeletedRaw === null) {
    return jsonError(req, 400, "BAD_REQUEST", "includeDeleted must be boolean.");
  }
  const includeDeleted = includeDeletedRaw === true;

  const from = parseFrom((body as any).from);
  if ((body as any).from !== undefined && !from) {
    return jsonError(req, 400, "BAD_REQUEST", "from must be ISO date/time or YYYY-MM-DD.");
  }

  const toParsed = parseTo((body as any).to);
  if ((body as any).to !== undefined && !toParsed) {
    return jsonError(req, 400, "BAD_REQUEST", "to must be ISO date/time or YYYY-MM-DD.");
  }

  const recipientListId = isNonEmptyString((body as any).recipientListId)
    ? String((body as any).recipientListId).trim()
    : null;

  // leak-safe: form + optional group + optional recipientList
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId: scoped.ctx.tenantId },
    select: { id: true, name: true, groupId: true },
  });
  if (!form) return jsonError(req, 404, "NOT_FOUND", "Form not found.");

  if (groupId) {
    const g = await prisma.group.findFirst({
      where: { id: groupId, tenantId: scoped.ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!g) return jsonError(req, 404, "NOT_FOUND", "Group not found.");
  }

  if (recipientListId) {
    const rl = await prisma.recipientList.findFirst({
      where: { id: recipientListId, tenantId: scoped.ctx.tenantId },
      select: { id: true },
    });
    if (!rl) return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");
  }

  const params = {
    formId,
    groupId,
    from: from ? from.toISOString() : null,
    to: toParsed?.lt ? toParsed.lt.toISOString() : toParsed?.lte ? toParsed.lte.toISOString() : null,
    includeDeleted,
    recipientListId,
  };

  // Create job first
  const job = await prisma.exportJob.create({
    data: {
      tenantId: scoped.ctx.tenantId,
      type: "CSV",
      status: "QUEUED",
      formId: form.id,
      recipientListId: recipientListId ?? null,
      requestedByUserId: scoped.ctx.user.id,
      params: params as any,
      queuedAt: new Date(),
    },
    select: { id: true },
  });

  const startedAt = new Date();
  await prisma.exportJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt },
  });

  try {
    // fields for dynamic columns (stable order)
    const fields = await prisma.formField.findMany({
      where: { tenantId: scoped.ctx.tenantId, formId: form.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { key: true, label: true, type: true, sortOrder: true },
    });

    // query leads
    const where: Prisma.LeadWhereInput = {
      tenantId: scoped.ctx.tenantId,
      formId: form.id,
      ...(groupId ? { groupId } : {}),
      ...(includeDeleted ? {} : { isDeleted: false }),
      ...(from || toParsed
        ? {
            capturedAt: {
              ...(from ? { gte: from } : {}),
              ...(toParsed?.lt ? { lt: toParsed.lt } : {}),
              ...(toParsed?.lte ? { lte: toParsed.lte } : {}),
            },
          }
        : {}),
    };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        capturedAt: true,
        isDeleted: true,
        group: { select: { name: true } },
        capturedByDevice: { select: { deviceUid: true } },
        values: true,
        attachments: { select: { type: true } },
      },
    });

    // Build header
    const baseHeaders = [
      "Lead ID",
      "Erfasst am",
      "Erfasst am (ISO)",
      "Gruppe",
      "Device",
      "Deleted",
      "Visitenkarte vorhanden",
    ];

    const fieldHeaders: string[] = [];
    for (const f of fields) {
      const h = (f.label?.trim() || f.key).trim();
      fieldHeaders.push(h);

      // Regel: Datum -> human + ISO-Spalte (für DATE/DATETIME Felder)
      if (f.type === "DATE" || f.type === "DATETIME") {
        fieldHeaders.push(`${h} (ISO)`);
      }
    }

    const headerLine = [...baseHeaders, ...fieldHeaders].map(csvEscape).join(";");

    const lines: string[] = [headerLine];

    for (const l of leads) {
      const values = (l.values ?? {}) as any;

      const hasCard =
        Array.isArray(l.attachments) &&
        l.attachments.some((a) => a.type === "IMAGE" || a.type === "PDF");

      const baseCols: string[] = [
        l.id,
        deChHumanDate(l.capturedAt),
        l.capturedAt.toISOString(),
        l.group?.name ?? "",
        l.capturedByDevice?.deviceUid ?? "",
        l.isDeleted ? "ja" : "nein",
        hasCard ? "ja" : "nein",
      ];

      const fieldCols: string[] = [];
      for (const f of fields) {
        const raw = values?.[f.key];
        const { human, iso } = valueToStringForFieldType(f.type, raw);
        fieldCols.push(human ?? "");
        if (f.type === "DATE" || f.type === "DATETIME") {
          fieldCols.push(iso ?? "");
        }
      }

      lines.push([...baseCols, ...fieldCols].map(csvEscape).join(";"));
    }

    const bom = "\ufeff"; // UTF-8 BOM
    const csv = bom + lines.join("\r\n") + "\r\n";

    // Write local tmp file (MVP storage stub)
    const dir = path.join(process.cwd(), ".tmp_exports", scoped.ctx.tenantId);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `export_${job.id}.csv`);
    fs.writeFileSync(filePath, csv, { encoding: "utf8" });

    const finishedAt = new Date();
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        finishedAt,
        resultStorageKey: filePath,
        resultUrl: null,
        error: null,
      },
    });

    // AuditEvent (best effort)
    try {
      await prisma.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "EXPORT_CSV_CREATED",
          entityType: "EXPORT_JOB",
          entityId: job.id,
          meta: {
            params,
            leadCount: leads.length,
            filePath,
          },
        },
      });
    } catch {
      // ignore
    }

    return jsonOk(
      req,
      {
        id: job.id,
        status: "DONE",
        downloadUrl: `/api/admin/v1/exports/${job.id}/download`,
        file: {
          separator: ";",
          bom: true,
        },
      },
      { status: 201 }
    );
  } catch (e: any) {
    const finishedAt = new Date();
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt,
        error: String(e?.message || "Export failed."),
      },
    });

    // AuditEvent (best effort)
    try {
      await prisma.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "EXPORT_CSV_FAILED",
          entityType: "EXPORT_JOB",
          entityId: job.id,
          meta: { params, error: String(e?.message || "") },
        },
      });
    } catch {
      // ignore
    }

    return jsonError(req, 500, "INTERNAL_ERROR", "CSV export failed.");
  }
}
