import prisma from "../../lib/prisma";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: { name: "Demo Tenant", status: "ACTIVE", retentionDays: 365 },
    create: { slug: "demo", name: "Demo Tenant", status: "ACTIVE", retentionDays: 365 },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@demo.local" },
    update: { name: "Demo Owner", role: "TENANT_OWNER", tenantId: tenant.id },
    create: { email: "owner@demo.local", name: "Demo Owner", role: "TENANT_OWNER", tenantId: tenant.id },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.local" },
    update: { name: "Demo Admin", role: "TENANT_ADMIN", tenantId: tenant.id },
    create: { email: "admin@demo.local", name: "Demo Admin", role: "TENANT_ADMIN", tenantId: tenant.id },
  });

  const orphanOwner = await prisma.user.upsert({
    where: { email: "orphan@demo.local" },
    update: { name: "Orphan Owner", role: "TENANT_OWNER", tenantId: null },
    create: { email: "orphan@demo.local", name: "Orphan Owner", role: "TENANT_OWNER", tenantId: null },
  });

  console.log("✅ Demo data ready");
  console.log(`Tenant:        ${tenant.id} (slug=${tenant.slug})`);
  console.log(`Owner (OK):    ${owner.id} (email=${owner.email})`);
  console.log(`Admin (403):   ${admin.id} (email=${admin.email})`);
  console.log(`Orphan (403):  ${orphanOwner.id} (email=${orphanOwner.email})`);
  console.log("");
  console.log(`Use for whoami:        x-user-id: ${owner.id}`);
  console.log(`Use for tenant/current x-user-id: ${owner.id}`);
  console.log(`Scope leak test:       add x-tenant-id: SOME_OTHER_TENANT_ID`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ create-demo-user failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
