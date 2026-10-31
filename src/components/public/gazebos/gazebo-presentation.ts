/** Show a shared schedule only when every displayed resource supplies the same one. */
export function getGazeboWorkingHours(resources: readonly { metadata: unknown }[]): string | null {
  const hours = resources.map(({ metadata }) => {
    if (!metadata || typeof metadata !== "object" || !("workingHours" in metadata)) return null;
    const value = metadata.workingHours;
    if (!value || typeof value !== "object" || !("from" in value) || !("to" in value)) return null;
    const { from, to } = value;
    const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    return typeof from === "string" && typeof to === "string" && validTime.test(from) && validTime.test(to)
      ? `${from}–${to}` : null;
  });
  return hours.length > 0 && hours[0] !== null && hours.every((item) => item === hours[0]) ? hours[0] : null;
}
