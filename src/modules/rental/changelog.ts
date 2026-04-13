import { prisma } from "@/lib/db";

type ChangeEntry = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

/**
 * Log field-level changes for rental entities.
 * Compares old and new objects, records every changed field.
 */
export async function logRentalChanges(
  userId: string,
  entity: string,
  entityId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  reason?: string,
  ipAddress?: string
): Promise<ChangeEntry[]> {
  const changes: ChangeEntry[] = [];

  for (const key of Object.keys(newData)) {
    if (newData[key] === undefined) continue;

    const oldVal = oldData[key];
    const newVal = newData[key];

    // Normalize for comparison (Decimal → number, Date → ISO string)
    const oldNorm = normalize(oldVal);
    const newNorm = normalize(newVal);

    if (oldNorm !== newNorm) {
      changes.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }

  if (changes.length > 0) {
    await prisma.rentalChangeLog.createMany({
      data: changes.map((c) => ({
        userId,
        entity,
        entityId,
        field: c.field,
        oldValue: c.oldValue != null ? String(c.oldValue) : null,
        newValue: c.newValue != null ? String(c.newValue) : null,
        reason,
        ipAddress,
      })),
    });
  }

  return changes;
}

function normalize(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/**
 * Get change history for a specific entity.
 */
export async function getChangeHistory(entity: string, entityId: string, limit = 50) {
  return prisma.rentalChangeLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
