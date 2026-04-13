/**
 * Import real data from реестр_селятино.xlsx into the database.
 * Usage: npx tsx scripts/import-excel.ts
 *
 * Parses sheets: Контакты (tenants + contracts), Свободные (vacant offices), Лист2 (room map)
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const prisma = new PrismaClient();

// ── Helpers ──

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) return "7" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  return digits.slice(0, 11);
}

function extractPhones(text: string): string[] {
  // Match sequences of digits that look like phone numbers
  const phones: string[] = [];
  const patterns = text.match(/[\d][\d\s\-()]{8,}[\d]/g) || [];
  for (const p of patterns) {
    const norm = normalizePhone(p);
    if (norm && norm.length === 11) phones.push(norm);
  }
  return [...new Set(phones)];
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[\w.\-+]+@[\w.\-]+\.\w+/g) || [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

function extractContactName(text: string): string | null {
  // Look for Russian first names in parentheses or standalone
  const nameInParens = text.match(/\(([А-Яа-яЁё]+)\)/);
  if (nameInParens) return nameInParens[1];

  // Look for standalone names before phone/email
  const nameMatch = text.match(/^([А-Яа-яЁё]+)\s/);
  if (nameMatch && nameMatch[1].length > 2) return nameMatch[1];

  return null;
}

function detectTenantType(name: string): "COMPANY" | "IP" | "INDIVIDUAL" {
  const upper = name.toUpperCase().trim();
  if (upper.startsWith("ООО") || upper.startsWith("АО") || upper.startsWith("ЗАО") || upper.startsWith("ЗТЛ")) return "COMPANY";
  if (upper.startsWith("ИП")) return "IP";
  if (upper.startsWith("ЦЕРКОВЬ") || upper.startsWith("ВИТА ВЕРДЕ")) return "COMPANY";
  // Check if it looks like a company name (all caps, no patronymic)
  if (!name.includes(" ") && name === name.toUpperCase()) return "COMPANY";
  return "INDIVIDUAL";
}

type ParsedLocation = {
  floor: number;
  building: number;
  number: string;
  officeType: "OFFICE" | "CONTAINER";
};

function parseLocation(raw: string): ParsedLocation[] {
  const text = raw.trim();

  // Container
  const containerMatch = text.match(/контейнер\s*[№#]?\s*([\d,\s]+)/i);
  if (containerMatch) {
    const nums = containerMatch[1].split(/[,\s]+/).filter(Boolean);
    return nums.map((n) => ({ floor: 1, building: 0, number: n.trim(), officeType: "CONTAINER" as const }));
  }

  // Standard: "этаж X, корпус Y, помещение Z"
  const stdMatch = text.match(/этаж\s*(\d+)\s*,\s*корп(?:ус)?\s*(\d+)\s*,?\s*помещени[ея]\s*([\d\w,а\s]+)/i);
  if (stdMatch) {
    const floor = parseInt(stdMatch[1]);
    const building = parseInt(stdMatch[2]);
    const rooms = stdMatch[3].split(/[,]\s*/).map((r) => r.trim()).filter(Boolean);
    return rooms.map((number) => ({ floor, building, number, officeType: "OFFICE" as const }));
  }

  return [];
}

function excelDateToISO(serial: number): string {
  // Excel serial date → JS Date
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

function autoContractStatus(startDate: Date, endDate: Date): "DRAFT" | "ACTIVE" | "EXPIRING" | "EXPIRED" {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (endDate < now) return "EXPIRED";
  if (startDate > now) return "DRAFT";
  if (endDate < in30Days) return "EXPIRING";
  return "ACTIVE";
}

// ── Main ──

async function main() {
  const filePath = path.resolve("/Users/elliott/Downloads/реестр селятино.xlsx");
  const wb = XLSX.readFile(filePath);

  console.log("📊 Reading реестр селятино.xlsx...\n");

  // ── Parse Контакты sheet ──
  const contactsSheet = wb.Sheets["Контакты"];
  const contactsData: unknown[][] = XLSX.utils.sheet_to_json(contactsSheet, { header: 1, defval: "" });
  // Headers: [Арендатор, кв.м, Цена за 1 кв.м, Сумма платежа, Валюта, Номер помещения, Повышение платежа, Закрытие договора, Контакты, col9, col10, ...]

  // ── Parse Свободные sheet ──
  const freeSheet = wb.Sheets["Свободные"];
  const freeData: unknown[][] = XLSX.utils.sheet_to_json(freeSheet, { header: 1, defval: "" });

  // ── Build room map from Лист2 ──
  // Format: корпус.этаж.номер — we already have this from location parsing

  // ── Step 1: Parse all rows from Контакты ──

  type ParsedRow = {
    tenantName: string;
    tenantType: "COMPANY" | "IP" | "INDIVIDUAL";
    area: number;
    pricePerSqm: number;
    monthlyRate: number;
    currency: string;
    locations: ParsedLocation[];
    endDate: string | null;
    contacts: string;
    contactName: string | null;
    phone: string | null;
    phonesExtra: string[];
    email: string | null;
    emailsExtra: string[];
    needsLegalAddress: boolean;
    notes: string;
    newPricePerSqm: number | null;
    hasIncrease: boolean;
  };

  const rows: ParsedRow[] = [];
  let lastTenant: string | null = null;

  for (let i = 1; i < contactsData.length; i++) {
    const row = contactsData[i];
    if (!row || row.every((c) => c === "" || c === undefined)) continue;

    const tenantRaw = String(row[0] || "").trim();
    const areaRaw = row[1];
    const pricePerSqmRaw = row[2];
    const monthlyRateRaw = row[3];
    const currency = String(row[4] || "руб.").trim();
    const locationRaw = String(row[5] || "").trim();
    const endDateRaw = row[7];
    const contactsRaw = String(row[8] || "").trim();
    const col9 = String(row[9] || "").trim();
    const col10 = String(row[10] || "").trim();

    // Skip summary/header rows
    if (tenantRaw.includes("1 час переговорная")) continue;
    if (!areaRaw && !locationRaw && !tenantRaw) continue;

    const area = typeof areaRaw === "number" ? areaRaw : parseFloat(String(areaRaw)) || 0;
    const pricePerSqm = typeof pricePerSqmRaw === "number" ? pricePerSqmRaw : parseFloat(String(pricePerSqmRaw)) || 0;
    const monthlyRate = typeof monthlyRateRaw === "number" ? monthlyRateRaw : parseFloat(String(monthlyRateRaw)) || 0;

    if (area === 0 && !locationRaw) continue;

    const tenantName = tenantRaw || lastTenant || "";
    if (tenantRaw) lastTenant = tenantRaw;

    const locations = parseLocation(locationRaw);

    // Parse end date (Excel serial number)
    let endDate: string | null = null;
    if (typeof endDateRaw === "number" && endDateRaw > 40000) {
      endDate = excelDateToISO(endDateRaw);
    }

    // Parse contacts
    const phones = extractPhones(contactsRaw);
    const emails = extractEmails(contactsRaw);
    const contactName = extractContactName(contactsRaw);

    // Parse col9/col10 — legal address, price increase
    let needsLegalAddress = false;
    let newPricePerSqm: number | null = null;
    let notes = "";
    const hasIncrease = col10 === "+";

    if (col9.toLowerCase().includes("юр адрес")) {
      needsLegalAddress = true;
    } else if (col9 && !isNaN(Number(col9))) {
      newPricePerSqm = Number(col9);
    } else if (col9 && col9 !== "+" && col9.length > 1) {
      notes = col9;
    }

    rows.push({
      tenantName,
      tenantType: detectTenantType(tenantName),
      area,
      pricePerSqm,
      monthlyRate,
      currency: currency === "руб." ? "RUB" : currency,
      locations,
      endDate,
      contacts: contactsRaw,
      contactName,
      phone: phones[0] || null,
      phonesExtra: phones.slice(1),
      email: emails[0] || null,
      emailsExtra: emails.slice(1),
      needsLegalAddress,
      notes,
      newPricePerSqm,
      hasIncrease,
    });
  }

  console.log(`📋 Parsed ${rows.length} contract rows from Контакты\n`);

  // ── Step 2: Dedupe tenants ──

  const tenantMap = new Map<string, {
    name: string;
    type: "COMPANY" | "IP" | "INDIVIDUAL";
    contactName: string | null;
    phone: string | null;
    phonesExtra: string[];
    email: string | null;
    emailsExtra: string[];
    needsLegalAddress: boolean;
    notes: string;
  }>();

  for (const r of rows) {
    if (!r.tenantName) continue;
    const existing = tenantMap.get(r.tenantName);
    if (!existing) {
      tenantMap.set(r.tenantName, {
        name: r.tenantName,
        type: r.tenantType,
        contactName: r.contactName,
        phone: r.phone,
        phonesExtra: r.phonesExtra,
        email: r.email,
        emailsExtra: r.emailsExtra,
        needsLegalAddress: r.needsLegalAddress,
        notes: r.notes,
      });
    } else {
      // Merge additional contacts
      if (r.phone && r.phone !== existing.phone && !existing.phonesExtra.includes(r.phone)) {
        existing.phonesExtra.push(r.phone);
      }
      for (const p of r.phonesExtra) {
        if (p !== existing.phone && !existing.phonesExtra.includes(p)) {
          existing.phonesExtra.push(p);
        }
      }
      if (r.email && r.email !== existing.email && !existing.emailsExtra.includes(r.email)) {
        existing.emailsExtra.push(r.email);
      }
      for (const e of r.emailsExtra) {
        if (e !== existing.email && !existing.emailsExtra.includes(e)) {
          existing.emailsExtra.push(e);
        }
      }
      if (r.needsLegalAddress) existing.needsLegalAddress = true;
      if (r.notes && !existing.notes.includes(r.notes)) {
        existing.notes = existing.notes ? `${existing.notes}; ${r.notes}` : r.notes;
      }
    }
  }

  console.log(`👥 Unique tenants: ${tenantMap.size}`);

  // ── Step 3: Import into DB ──

  // Clear existing rental data
  console.log("\n🗑️  Clearing existing rental data...");
  await prisma.rentalContract.deleteMany({});
  await prisma.rentalInquiry.deleteMany({});
  await prisma.office.deleteMany({});
  await prisma.tenant.deleteMany({});
  console.log("   Done.\n");

  // Import tenants
  console.log("👥 Importing tenants...");
  const tenantIds = new Map<string, string>();

  for (const [name, t] of tenantMap) {
    const tenant = await prisma.tenant.create({
      data: {
        companyName: name,
        tenantType: t.type,
        contactName: t.contactName,
        phone: t.phone,
        phonesExtra: t.phonesExtra.length > 0 ? t.phonesExtra : undefined,
        email: t.email,
        emailsExtra: t.emailsExtra.length > 0 ? t.emailsExtra : undefined,
        needsLegalAddress: t.needsLegalAddress,
        notes: t.notes || undefined,
      },
    });
    tenantIds.set(name, tenant.id);
  }
  console.log(`   ✓ ${tenantIds.size} tenants imported`);

  // Import offices (from contracts + free offices)
  console.log("🏢 Importing offices...");
  const officeIds = new Map<string, string>(); // "building-floor-number" → id
  let officeCount = 0;

  // From Контакты: offices that have contracts
  for (const r of rows) {
    for (const loc of r.locations) {
      const key = `${loc.building}-${loc.floor}-${loc.number}`;
      if (officeIds.has(key)) continue;

      const office = await prisma.office.create({
        data: {
          number: loc.number,
          floor: loc.floor,
          building: loc.building,
          officeType: loc.officeType,
          area: r.area / r.locations.length, // Split area if multiple rooms per row
          pricePerMonth: r.monthlyRate / r.locations.length,
          status: "OCCUPIED",
        },
      });
      officeIds.set(key, office.id);
      officeCount++;
    }
  }

  // From Свободные: vacant offices
  for (let i = 1; i < freeData.length; i++) {
    const row = freeData[i];
    if (!row || row.every((c) => c === "" || c === undefined)) continue;

    const floorRaw = row[0];
    const numberRaw = String(row[1] || "").trim();
    const areaRaw = row[2];
    const wetPoint = String(row[3] || "").toLowerCase() === "да";
    const toilet = String(row[4] || "").toLowerCase() === "да";
    const roofAccess = String(row[5] || "").toLowerCase() !== "нет" && String(row[5] || "") !== "";
    const pricePerSqm = typeof row[6] === "number" ? row[6] : 0;
    const pricePerMonth = typeof row[7] === "number" ? row[7] : 0;
    const comment = String(row[8] || "").trim() || null;

    // Skip header row, label rows
    if (numberRaw === "КОНТЕЙНЕРЫ" || numberRaw === "Номер офиса") continue;
    if (!numberRaw || numberRaw.includes("кв.м")) continue;

    const floor = typeof floorRaw === "number" ? floorRaw : 1;

    // Parse number format "building.floor.number" (e.g., "1.1.52") or just number
    let building = 0;
    let officeFloor = floor;
    let officeNumber = numberRaw;
    let officeType: "OFFICE" | "CONTAINER" = "OFFICE";

    const bfnMatch = numberRaw.match(/^(\d+)\.(\d+)\.(\d+\w*)$/);
    if (bfnMatch) {
      building = parseInt(bfnMatch[1]);
      officeFloor = parseInt(bfnMatch[2]);
      officeNumber = bfnMatch[3];
    } else if (numberRaw === "гараж") {
      officeType = "CONTAINER";
      officeNumber = "гараж";
    } else if (typeof row[1] === "number") {
      // Container number
      officeType = "CONTAINER";
      officeNumber = String(row[1]);
      building = 0;
    }

    let area = 0;
    if (typeof areaRaw === "number") {
      area = areaRaw;
    } else if (typeof areaRaw === "string") {
      const num = parseFloat(areaRaw.replace(",", "."));
      if (!isNaN(num)) area = num;
    }

    if (area === 0) continue;

    const key = `${building}-${officeFloor}-${officeNumber}`;
    if (officeIds.has(key)) continue;

    const office = await prisma.office.create({
      data: {
        number: officeNumber,
        floor: officeFloor,
        building,
        officeType,
        area,
        pricePerMonth,
        hasWetPoint: wetPoint,
        hasToilet: toilet,
        hasRoofAccess: roofAccess,
        status: "AVAILABLE",
        comment,
      },
    });
    officeIds.set(key, office.id);
    officeCount++;
  }

  console.log(`   ✓ ${officeCount} offices imported`);

  // Import contracts
  console.log("📝 Importing contracts...");
  let contractCount = 0;
  let errors = 0;

  for (const r of rows) {
    if (!r.tenantName) continue;

    const tenantId = tenantIds.get(r.tenantName);
    if (!tenantId) {
      console.error(`   ✗ Tenant not found: "${r.tenantName}"`);
      errors++;
      continue;
    }

    for (const loc of r.locations) {
      const key = `${loc.building}-${loc.floor}-${loc.number}`;
      const officeId = officeIds.get(key);
      if (!officeId) {
        console.error(`   ✗ Office not found: ${key} for "${r.tenantName}"`);
        errors++;
        continue;
      }

      // Default start date: 1 year before end date, or 2025-01-01
      const endDate = r.endDate ? new Date(r.endDate) : new Date("2027-01-01");
      const startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - 1);

      const status = autoContractStatus(startDate, endDate);

      const monthlyForThisRoom = r.locations.length > 1
        ? r.monthlyRate / r.locations.length
        : r.monthlyRate;
      const areaForThisRoom = r.locations.length > 1
        ? r.area / r.locations.length
        : r.area;
      const pricePerSqmForThisRoom = areaForThisRoom > 0
        ? r.pricePerSqm
        : 0;

      try {
        await prisma.rentalContract.create({
          data: {
            tenantId,
            officeId,
            startDate,
            endDate,
            pricePerSqm: pricePerSqmForThisRoom || undefined,
            monthlyRate: monthlyForThisRoom,
            currency: r.currency,
            newPricePerSqm: r.newPricePerSqm || undefined,
            status,
            notes: r.notes || undefined,
          },
        });

        // Mark office as occupied if contract is active
        if (status === "ACTIVE" || status === "EXPIRING") {
          await prisma.office.update({
            where: { id: officeId },
            data: { status: "OCCUPIED" },
          });
        }

        contractCount++;
      } catch (err) {
        console.error(`   ✗ Contract ${r.tenantName} → ${key}: ${err instanceof Error ? err.message : err}`);
        errors++;
      }
    }
  }

  console.log(`   ✓ ${contractCount} contracts imported`);

  // ── Summary ──
  const totalTenants = await prisma.tenant.count();
  const totalOffices = await prisma.office.count();
  const totalContracts = await prisma.rentalContract.count();
  const occupiedOffices = await prisma.office.count({ where: { status: "OCCUPIED" } });
  const activeContracts = await prisma.rentalContract.count({
    where: { status: { in: ["ACTIVE", "EXPIRING"] } },
  });

  console.log(`\n✅ Import completed! (${errors} errors)`);
  console.log(`   Tenants:   ${totalTenants}`);
  console.log(`   Offices:   ${totalOffices} (${occupiedOffices} occupied)`);
  console.log(`   Contracts: ${totalContracts} (${activeContracts} active)`);
}

main()
  .catch((e) => {
    console.error("❌ Import failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
