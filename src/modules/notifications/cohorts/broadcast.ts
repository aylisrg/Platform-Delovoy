import { prisma } from "@/lib/db";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import { SEGMENT_RESOLVERS, type SegmentKey } from "./segments";
import type { BroadcastInput } from "./validation";
import { logAudit } from "@/lib/logger";

export type BroadcastResult = {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
};

export async function broadcastToSegment(
  input: BroadcastInput,
  createdBy: string
): Promise<BroadcastResult> {
  const resolver = SEGMENT_RESOLVERS[input.segmentKey as SegmentKey];
  const userIds = await resolver(prisma);

  const payload = {
    title: input.title,
    body: input.body,
    ...(input.ctaLabel && {
      actions: [{ label: input.ctaLabel, url: input.ctaUrl }],
    }),
  };

  const campaign = await prisma.broadcastCampaign.create({
    data: {
      segmentKey: input.segmentKey,
      eventType: "BROADCAST",
      payload,
      createdBy,
      total: userIds.length,
      status: "running",
    },
  });

  let sent = 0;
  let failed = 0;

  for (const userId of userIds) {
    const outcome = await dispatch({
      userId,
      eventType: "BROADCAST",
      entityType: "BroadcastCampaign",
      entityId: campaign.id,
      payload,
    });

    if (outcome.status === "queued" || outcome.status === "deferred") {
      sent++;
    } else {
      failed++;
    }

    // Persist progress incrementally
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { sent, failed },
    });
  }

  await prisma.broadcastCampaign.update({
    where: { id: campaign.id },
    data: { status: "completed" },
  });

  await logAudit(createdBy, "broadcast.create", "BroadcastCampaign", campaign.id, {
    segmentKey: input.segmentKey,
    total: userIds.length,
    sent,
    failed,
  });

  return { campaignId: campaign.id, total: userIds.length, sent, failed };
}

export async function getCampaigns(limit = 20) {
  return prisma.broadcastCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
