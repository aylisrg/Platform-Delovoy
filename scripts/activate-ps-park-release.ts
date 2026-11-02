import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { prisma } from "../src/lib/db";
import { hashDocumentBody } from "../src/modules/booking/offer";
import {
  activatePSParkRelease, assertPSParkReleaseContext, rollbackPSParkRelease,
  PS_PARK_ACTIVATION_RELEASE_ID, PS_PARK_APPROVED_OFFER_HASH,
} from "./lib/ps-park-release";
import { verifyPSParkReleaseLive } from "./lib/ps-park-release-http";
import { runPSParkRelease } from "./lib/ps-park-release-runner";

async function main() {
  const context = {
    expectedSha: process.argv[2] ?? "",
    nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    buildSha: process.env.BUILD_GIT_SHA,
  };
  // Validate before HTTP or database access. Ordinary seed and staging never call this.
  assertPSParkReleaseContext(context);
  if (hashDocumentBody(readFileSync("content/legal/ps-park-offer/v2.md", "utf8")) !== PS_PARK_APPROVED_OFFER_HASH) {
    throw new Error("PACKAGED_OFFER_MISMATCH");
  }
  const result = await runPSParkRelease({
    verify: async (enabled, requireOffer) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await verifyPSParkReleaseLive(context.expectedSha, enabled, requireOffer);
          return;
        } catch (error) {
          if (attempt === 2) throw error;
          await setTimeout(500);
        }
      }
    },
    activate: () => activatePSParkRelease(prisma, context),
    rollback: async () => {
      const rollback = await rollbackPSParkRelease(prisma, context);
      console.log("PS_PARK_RELEASE_ROLLBACK " + JSON.stringify(rollback));
    },
  });
  console.log("PS_PARK_RELEASE_VERIFIED " + JSON.stringify({
    releaseId: PS_PARK_ACTIVATION_RELEASE_ID,
    gitSha: context.expectedSha,
    ...result,
    liveCheckout: result.onlineBookingEnabled ? "enabled" : "disabled",
  }));
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "RELEASE_FAILED";
  console.error(`PS_PARK_RELEASE_ERROR ${code}`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
