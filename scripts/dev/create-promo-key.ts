// scripts/dev/create-promo-key.ts
import { PrismaClient } from "@prisma/client";
import { generateLicenseKey } from "../../lib/license";

const prisma = new PrismaClient();

function parseDurationDays(argv: string[]): number {
  // Usage examples:
  //   ts-node ... scripts/dev/create-promo-key.ts
  //   ts-node ... scripts/dev/create-promo-key.ts 365
  //   ts-node ... scripts/dev/create-promo-key.ts --days=30
  //   ts-node ... scripts/dev/create-promo-key.ts --days 365
  let days: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;

    if (a.startsWith("--days=")) {
      days = a.split("=", 2)[1];
      break;
    }
    if (a === "--days" || a === "--durationDays" || a === "--duration") {
      days = argv[i + 1];
      break;
    }
  }

  if (!days) {
    // positional arg
    days = argv[0];
  }

  const n = days ? Number(days) : 30;
  if (n !== 30 && n !== 365) {
    throw new Error("Invalid durationDays. Allowed: 30 or 365");
  }
  return n;
}

async function main() {
  const durationDays = parseDurationDays(process.argv.slice(2));

  // generate unique key (retry on collision)
  let created: { id: string; key: string; durationDays: number } | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const key = generateLicenseKey({ prefix: "LR", groups: 4, groupLength: 4 });
    try {
      created = await prisma.licenseKey.create({
        data: {
          key,
          source: "PROMO",
          status: "ISSUED",
          tenantId: null,
          durationDays,
          issuedAt: new Date(),
        },
        select: { id: true, key: true, durationDays: true },
      });
      break;
    } catch (err: any) {
      if (err?.code === "P2002") continue; // unique collision on key
      throw err;
    }
  }

  if (!created) {
    throw new Error("Failed to generate unique promo key");
  }

  console.log("PROMO_KEY:", created.key);
  console.log("DURATION_DAYS:", created.durationDays);
  console.log("LICENSE_KEY_ID:", created.id);
}

main()
  .catch((e) => {
    console.error("ERROR:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
