/**
 * Account-level operations: balance + Avito self-account lookup.
 */

import { prisma } from "@/lib/db";
import { avitoFetch, isAvitoCredentialsConfigured } from "./client";
import type { AvitoAccountDto } from "./types";

const LOW_BALANCE_THRESHOLD_RUB = 500;

/** Read /core/v1/accounts/self — gives us avitoUserId required by Messenger API. */
export async function fetchSelfAccount(): Promise<{ id: string; name?: string } | null> {
  if (!isAvitoCredentialsConfigured()) return null;
  try {
    const res = await avitoFetch<{ id?: number; name?: string }>("/core/v1/accounts/self");
    if (!res?.id) return null;
    return { id: String(res.id), name: res.name };
  } catch {
    return null;
  }
}

/** Read wallet balance from Avito. Returns null if unavailable. */
export async function fetchBalance(): Promise<number | null> {
  if (!isAvitoCredentialsConfigured()) return null;
  try {
    // Avito exposes the wallet balance via /core/v1/accounts/self/balance/
    const res = await avitoFetch<{ real?: number; bonus?: number }>("/core/v1/accounts/self/balance/");
    if (typeof res?.real !== "number") return null;
    return res.real;
  } catch {
    return null;
  }
}

/** Refresh AvitoIntegration row with the latest balance/account snapshot. */
export async function syncAccount(): Promise<void> {
  if (!isAvitoCredentialsConfigured()) return;

  const [account, balance] = await Promise.all([fetchSelfAccount(), fetchBalance()]);

  await prisma.avitoIntegration.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      avitoUserId: account?.id ?? null,
      accountName: account?.name ?? null,
      lastBalanceRub: balance !== null ? String(balance) : null,
      lastBalanceSyncAt: balance !== null ? new Date() : null,
      lastAccountSyncAt: account ? new Date() : null,
    },
    update: {
      avitoUserId: account?.id ?? undefined,
      accountName: account?.name ?? undefined,
      lastBalanceRub: balance !== null ? String(balance) : undefined,
      lastBalanceSyncAt: balance !== null ? new Date() : undefined,
      lastAccountSyncAt: account ? new Date() : undefined,
    },
  });
}

/** Public DTO of the integration state — for the admin dashboard. */
export async function getAccountSnapshot(): Promise<AvitoAccountDto> {
  const integration = await prisma.avitoIntegration.findUnique({ where: { id: "default" } });
  const balance = integration?.lastBalanceRub ? Number(integration.lastBalanceRub) : null;
  return {
    configured: isAvitoCredentialsConfigured(),
    accountName: integration?.accountName ?? null,
    avitoUserId: integration?.avitoUserId ?? null,
    balanceRub: integration?.lastBalanceRub ? integration.lastBalanceRub.toString() : null,
    lowBalanceWarning: balance !== null && balance < LOW_BALANCE_THRESHOLD_RUB,
    lastBalanceSyncAt: integration?.lastBalanceSyncAt?.toISOString() ?? null,
    webhookEnabled: integration?.webhookEnabled ?? false,
    pollEnabled: integration?.pollEnabled ?? true,
  };
}
