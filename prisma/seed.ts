// prisma/seed.ts
import prisma from "../lib/prisma";

async function main() {
  // Minimal, but useful seed:
  // - 2 System-Templates (tenantId = null, kind = SYSTEM)
  // - 2 Packages (30/365 Tage) mit neutralen Preisen (0) als Platzhalter
  // NOTE: Preise/Details können später via Admin/Stripe gepflegt werden.

  const packages = [
    {
      code: "PKG_30",
      name: "Package 30 Tage",
      durationDays: 30,
      priceCents: 0,
      currency: "CHF",
      status: "ACTIVE" as const,
    },
    {
      code: "PKG_365",
      name: "Package 365 Tage",
      durationDays: 365,
      priceCents: 0,
      currency: "CHF",
      status: "ACTIVE" as const,
    },
  ];

  for (const p of packages) {
    await prisma.package.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        durationDays: p.durationDays,
        priceCents: p.priceCents,
        currency: p.currency,
        status: p.status,
      },
      create: {
        code: p.code,
        name: p.name,
        durationDays: p.durationDays,
        priceCents: p.priceCents,
        currency: p.currency,
        status: p.status,
      },
    });
  }

  const systemTemplates = [
    {
      systemKey: "SYS_TEMPLATE_BASIC",
      name: "System Template – Basic Lead",
      description: "Einfaches Lead-Formular (System-Template).",
      slug: "sys-basic-lead",
      definition: {
        version: 1,
        fields: [
          { key: "firstName", label: "Vorname", type: "TEXT", required: false },
          { key: "lastName", label: "Nachname", type: "TEXT", required: true },
          { key: "email", label: "E-Mail", type: "EMAIL", required: true },
          { key: "company", label: "Firma", type: "TEXT", required: false },
        ],
        config: {},
        theme: {},
      },
    },
    {
      systemKey: "SYS_TEMPLATE_PRODUCTS",
      name: "System Template – Products / Interest",
      description: "Lead + Interesse/Produkte (System-Template).",
      slug: "sys-products-interest",
      definition: {
        version: 1,
        fields: [
          { key: "name", label: "Name", type: "TEXT", required: true },
          { key: "email", label: "E-Mail", type: "EMAIL", required: true },
          {
            key: "interest",
            label: "Interesse",
            type: "SELECT",
            required: false,
            config: { options: ["Allgemein", "Produkt A", "Produkt B"] },
          },
          { key: "note", label: "Notiz", type: "TEXTAREA", required: false },
        ],
        config: {},
        theme: {},
      },
    },
  ];

  for (const t of systemTemplates) {
    await prisma.formTemplate.upsert({
      where: { systemKey: t.systemKey },
      update: {
        kind: "SYSTEM",
        tenantId: null,
        name: t.name,
        description: t.description,
        slug: t.slug,
        definition: t.definition as any,
      },
      create: {
        kind: "SYSTEM",
        systemKey: t.systemKey,
        tenantId: null,
        name: t.name,
        description: t.description,
        slug: t.slug,
        definition: t.definition as any,
      },
    });
  }

  console.log("✅ Seed completed: packages + system templates");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
