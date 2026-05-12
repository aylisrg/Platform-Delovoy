/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers";

export interface VkIdProfile {
  user: {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    verified?: boolean;
    sex?: number;
    birthday?: string;
  };
}

export function VkIdProvider(options: OAuthUserConfig<any>): OAuthConfig<any> {
  // NextAuth's OAuthConfig union types are strict — cast through unknown to
  // avoid spurious TS2322 errors on the checks/profile fields.
  const config: Record<string, unknown> = {
    id: "vk-id",
    name: "VK ID",
    type: "oauth",
    checks: ["pkce", "state"],
    authorization: {
      url: "https://id.vk.com/authorize",
      params: {
        scope: "email phone vkid.personal_info",
        response_type: "code",
      },
    },
    token: "https://id.vk.com/oauth2/token",
    userinfo: {
      // VK ID v2 user_info endpoint is POST-only with form-encoded body.
      // The client_id is not a secret — safe to include here.
      request: async ({ tokens }: { tokens: any }) => {
        const res = await fetch("https://id.vk.com/oauth2/user_info", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            access_token: String(tokens.access_token),
            client_id: String(options.clientId ?? process.env.VK_CLIENT_ID ?? ""),
          }),
        });
        return res.json() as Promise<VkIdProfile>;
      },
    },
    profile(profile: VkIdProfile) {
      const u = profile.user;
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
      return { id: String(u.id), name, email: u.email ?? null, image: u.avatar ?? null };
    },
    ...options,
  };
  return config as unknown as OAuthConfig<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
