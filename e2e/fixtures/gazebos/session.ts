export function useSession() { return { data: null, status: "unauthenticated" as const }; }
export async function signIn() { return { ok: false, error: "Authentication is disabled in this fixture." }; }
export async function signOut() { return undefined; }
