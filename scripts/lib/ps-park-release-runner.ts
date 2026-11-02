type ReleaseResult = { onlineBookingEnabled: boolean; changed: boolean; alreadyApplied: boolean };
type ReleaseActions = {
  verify: (enabled?: boolean, requireApprovedOffer?: boolean) => Promise<void>;
  activate: () => Promise<ReleaseResult>;
  rollback: () => Promise<unknown>;
};

/** Preflight before mutation; fail closed if verification of our new activation fails. */
export async function runPSParkRelease(actions: ReleaseActions) {
  await actions.verify();
  const result = await actions.activate();
  try {
    await actions.verify(result.onlineBookingEnabled, !result.alreadyApplied);
  } catch (error) {
    if (!result.alreadyApplied) await actions.rollback();
    throw error;
  }
  return result;
}
