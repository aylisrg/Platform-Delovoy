export function getSaunaHealth() {
  return { module: "sauna", status: "stub" as const, timestamp: new Date().toISOString() };
}
