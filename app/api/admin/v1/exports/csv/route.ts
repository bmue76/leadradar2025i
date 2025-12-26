// app/api/admin/v1/exports/csv/route.ts
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { httpError, isHttpError, validateBody } from "@/lib/http";

export const runtime = "nodejs";

const ExportCsvBodySchema = z.object({
  formId: z.string().min(1),
  groupId: z.string().min(1).optional().nullable(),
  recipientListId: z.string().min(1).optional().nullable(),
  includeDeleted: z.boolean().optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

function parseFrom(v: string | undefined): Date | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTo(v: string | undefined): { lt?: Date; lte?: Date } | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

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
  if (v === true) return "ja";
  if (v === false) return "nein";
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "ja"].includes(t)) return "ja";
    if (["0", "false", "no", "nein"].includes(t)) return "nein";
  }
  return Boolean(v) ? "ja" : "nein";
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

function valueToStringForFieldType(
  fieldType: string,
  v: unknown
): { human: string; iso?: string } {
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

function makeStorageKey(tenantId: string, jobId: string): string {
  // DB should store a RELATIVE key (stable across environments)
  // Always store as posix-ish path to avoid Windows backslashes in DB.
  return [".tmp_exports", tenantId, `export_${jobId}.csv`].join("/");
}

export async function POST(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  let jobId: string | null = null;

  try {
    const body = await validateBody(req, ExportCsvBodySchema);

    const formId = body.formId.trim();
    const groupId = body.groupId ? body.groupId.trim() : null;
    const recipientListId = body.recipientListId ? body.recipientListId.trim() : null;
    const includeDeleted = body.includeDeleted ?? false;

    const from = parseFrom(body.from);
    if (body.from !== undefined && !from) {
      throw httpError(400, "BAD_REQUEST", "from must be ISO date/time or YYYY-MM-DD.");
    }

    const toParsed = parseTo(body.to);
    if (body.to !== undefined && !toParsed) {
      throw httpError(400, "BAD_REQUEST", "to must be ISO date/time or YYYY-MM-DD.");
    }

    // leak-safe: form + optional group + optional recipientList
    const form = await prisma.form.findFirst({
      where: { id: formId, tenantId: scoped.ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!form) throw httpError(404, "NOT_FOUND", "Form not found.");

    if (groupId) {
      const g = await prisma.group.findFirst({
        where: { id: groupId, tenantId: scoped.ctx.tenantId },
        select: { id: true },
      });
      if (!g) throw httpError(404, "NOT_FOUND", "Group not found.");
    }

    if (recipientListId) {
      const rl = await prisma.recipientList.findFirst({
        where: { id: recipientListId, tenantId: scoped.ctx.tenantId },
        select: { id: true },
      });
      if (!rl) throw httpError(404, "NOT_FOUND", "Recipient list not found.");
    }

    const params: Prisma.InputJsonValue = {
      formId,
      groupId,
      from: from ? from.toISOString() : null,
      to: toParsed?.lt ? toParsed.lt.toISOString() : toParsed?.lte ? toParsed.lte.toISOString() : null,
      includeDeleted,
      recipientListId,
    };

    // Create job first
    const created = await prisma.exportJob.create({
      data: {
        tenantId: scoped.ctx.tenantId,
        type: "CSV",
        status: "QUEUED",
        formId: form.id,
        recipientListId,
        requestedByUserId: scoped.ctx.user.id,
        params,
        queuedAt: new Date(),
      },
      select: { id: true },
    });
    jobId = created.id;

    const startedAt = new Date();
    await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt },
    });

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
      const values = (l.values ?? {}) as Record<string, unknown>;

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
        const raw = values[f.key];
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
    const storageKey = makeStorageKey(scoped.ctx.tenantId, jobId);
    const absPath = path.join(process.cwd(), storageKey);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, csv, { encoding: "utf8" });

    const finishedAt = new Date();
    await prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: "DONE",
        finishedAt,
        resultStorageKey: storageKey,
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
          entityId: jobId,
          meta: {
            params,
            leadCount: leads.length,
            storageKey,
          },
        },
      });
    } catch {
      // ignore
    }

    return jsonOk(
      req,
      {
        id: jobId,
        status: "DONE",
        downloadUrl: `/api/admin/v1/exports/${jobId}/download`,
        file: { separator: ";", bom: true },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    // If job was created, mark as FAILED (best effort)
    if (jobId) {
      try {
        await prisma.exportJob.update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: isHttpError(err) ? err.message : String((err as any)?.message || "Export failed."),
          },
        });
      } catch {
        // ignore
      }

      try {
        await prisma.auditEvent.create({
          data: {
            tenantId: scoped.ctx.tenantId,
            actorType: "USER",
            actorUserId: scoped.ctx.user.id,
            action: "EXPORT_CSV_FAILED",
            entityType: "EXPORT_JOB",
            entityId: jobId,
            meta: { error: isHttpError(err) ? err.message : String((err as any)?.message || "") },
          },
        });
      } catch {
        // ignore
      }
    }

    if (isHttpError(err)) {
      return jsonError(req, err.status, err.code, err.message, err.details);
    }

    return jsonError(req, 500, "INTERNAL_ERROR", "CSV export failed.");
  }
}
