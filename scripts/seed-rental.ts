/**
 * Import rental data from seed-rental.json
 * Usage: npx tsx scripts/seed-rental.ts
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface ImportTenant {
  companyName: string;
  tenantType?: string;
  contactName?: string;
  phone?: string;
  phonesExtra?: string[];
  email?: string;
  emailsExtra?: string[];
  inn?: string;
  legalAddress?: string;
  needsLegalAddress?: boolean;
  notes?: string;
}

interface ImportOffice {
  number: string;
  floor: number;
  building: number;
  officeType?: string;
  area: number;
  pricePerMonth?: number;
  hasWetPoint?: boolean;
  hasToilet?: boolean;
  hasRoofAccess?: boolean;
  comment?: string;
}

interface ImportContract {
  tenantRef: string;
  officeRef: string;
  startDate: string;
  endDate: string;
  pricePerSqm?: number;
  monthlyRate: number;
  currency?: string;
  deposit?: number;
  contractNumber?: string;
  newPricePerSqm?: number;
  priceIncreaseDate?: string;
  notes?: string;
}

interface ImportData {
  tenants: ImportTenant[];
  offices: ImportOffice[];
  contracts: ImportContract[];
}

type TenantType = "COMPANY" | "IP" | "INDIVIDUAL";
type OfficeType = "OFFICE" | "CONTAINER" | "MEETING_ROOM";
type ContractStatus = "DRAFT" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "TERMINATED";

function autoContractStatus(startDate: Date, endDate: Date): ContractStatus {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (endDate < now) return "EXPIRED";
  if (startDate > now) return "DRAFT";
  if (endDate < in30Days) return "EXPIRING";
  return "ACTIVE";
}

async function main() {
  const filePath = path.join(__dirname, "seed-rental.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: ImportData = JSON.parse(raw);

  console.log(`📦 Importing: ${data.tenants.length} tenants, ${data.offices.length} offices, ${data.contracts.length} contracts\n`);

  const tenantMap = new Map<string, string>();
  const officeMap = new Map<string, string>();
  let errors = 0;

  // Import tenants
  console.log("👥 Importing tenants...");
  for (const t of data.tenants) {
    try {
      const existing = await prisma.tenant.findFirst({ where: { companyName: t.companyName } });
      const tenant = existing
        ? await prisma.tenant.update({
            where: { id: existing.id },
            data: {
              tenantType: (t.tenantType as TenantType) ?? "INDIVIDUAL",
              contactName: t.contactName,
              phone: t.phone,
              phonesExtra: t.phonesExtra ?? undefined,
              email: t.email,
              emailsExtra: t.emailsExtra ?? undefined,
              inn: t.inn,
              legalAddress: t.legalAddress,
              needsLegalAddress: t.needsLegalAddress ?? false,
              notes: t.notes,
            },
          })
        : await prisma.tenant.create({
            data: {
              companyName: t.companyName,
              tenantType: (t.tenantType as TenantType) ?? "INDIVIDUAL",
              contactName: t.contactName,
              phone: t.phone,
              phonesExtra: t.phonesExtra ?? undefined,
              email: t.email,
              emailsExtra: t.emailsExtra ?? undefined,
              inn: t.inn,
              legalAddress: t.legalAddress,
              needsLegalAddress: t.needsLegalAddress ?? false,
              notes: t.notes,
            },
          });
      tenantMap.set(t.companyName, tenant.id);
    } catch (err) {
      console.error(`  ✗ Tenant "${t.companyName}": ${err instanceof Error ? err.message : err}`);
      errors++;
    }
  }
  console.log(`  ✓ ${tenantMap.size} tenants imported`);

  // Import offices
  console.log("🏢 Importing offices...");
  for (const o of data.offices) {
    try {
      const office = await prisma.office.upsert({
        where: {
          building_floor_number: { building: o.building, floor: o.floor, number: o.number },
        },
        update: {
          officeType: (o.officeType as OfficeType) ?? "OFFICE",
          area: o.area,
          pricePerMonth: o.pricePerMonth ?? 0,
          hasWetPoint: o.hasWetPoint ?? false,
          hasToilet: o.hasToilet ?? false,
          hasRoofAccess: o.hasRoofAccess ?? false,
          comment: o.comment,
        },
        create: {
          number: o.number,
          floor: o.floor,
          building: o.building,
          officeType: (o.officeType as OfficeType) ?? "OFFICE",
          area: o.area,
          pricePerMonth: o.pricePerMonth ?? 0,
          hasWetPoint: o.hasWetPoint ?? false,
          hasToilet: o.hasToilet ?? false,
          hasRoofAccess: o.hasRoofAccess ?? false,
          comment: o.comment,
        },
      });
      officeMap.set(`${o.building}-${o.floor}-${o.number}`, office.id);
    } catch (err) {
      console.error(`  ✗ Office ${o.building}-${o.floor}-${o.number}: ${err instanceof Error ? err.message : err}`);
      errors++;
    }
  }
  console.log(`  ✓ ${officeMap.size} offices imported`);

  // Import contracts
  console.log("📝 Importing contracts...");
  let contractCount = 0;
  for (const c of data.contracts) {
    try {
      const tenantId = tenantMap.get(c.tenantRef);
      if (!tenantId) {
        console.error(`  ✗ Tenant not found: "${c.tenantRef}"`);
        errors++;
        continue;
      }
      const officeId = officeMap.get(c.officeRef);
      if (!officeId) {
        console.error(`  ✗ Office not found: "${c.officeRef}"`);
        errors++;
        continue;
      }

      const startDate = new Date(c.startDate);
      const endDate = new Date(c.endDate);
      const status = autoContractStatus(startDate, endDate);

      // Skip if contract already exists (idempotency)
      const existingContract = await prisma.rentalContract.findFirst({
        where: { tenantId, officeId, startDate, endDate },
      });
      if (existingContract) {
        console.log(`  ~ Contract already exists: ${c.tenantRef} → ${c.officeRef}, skipping`);
        contractCount++;
        continue;
      }

      await prisma.rentalContract.create({
        data: {
          tenantId,
          officeId,
          startDate,
          endDate,
          pricePerSqm: c.pricePerSqm,
          monthlyRate: c.monthlyRate,
          currency: c.currency ?? "RUB",
          deposit: c.deposit,
          contractNumber: c.contractNumber,
          newPricePerSqm: c.newPricePerSqm,
          priceIncreaseDate: c.priceIncreaseDate ? new Date(c.priceIncreaseDate) : undefined,
          status,
          notes: c.notes,
        },
      });

      // Sync office status
      if (status === "ACTIVE" || status === "EXPIRING") {
        await prisma.office.update({
          where: { id: officeId },
          data: { status: "OCCUPIED" },
        });
      }

      contractCount++;
    } catch (err) {
      console.error(`  ✗ Contract ${c.tenantRef} → ${c.officeRef}: ${err instanceof Error ? err.message : err}`);
      errors++;
    }
  }
  console.log(`  ✓ ${contractCount} contracts imported`);

  console.log(`\n✅ Import completed! (${errors} errors)`);
  console.log(`   Tenants: ${tenantMap.size}`);
  console.log(`   Offices: ${officeMap.size}`);
  console.log(`   Contracts: ${contractCount}`);
}

main()
  .catch((e) => {
    console.error("❌ Import failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
