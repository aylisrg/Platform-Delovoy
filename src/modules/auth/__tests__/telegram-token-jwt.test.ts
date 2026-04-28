import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_TYPE,
  verifyTelegramTokenJwt,
} from "../telegram-token-jwt";

const SECRET = "test-secret-please-replace-32chrs";

async function makeJwt(overrides: {
  sub?: string;
  jti?: string;
  type?: string;
  exp?: string;
  audience?: string;
  issuer?: string;
  secret?: string;
}): Promise<string> {
  const builder = new SignJWT({
    sub: overrides.sub ?? "user-1",
    jti: overrides.jti ?? "jti-abc",
    type: overrides.type ?? JWT_TYPE,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(overrides.issuer ?? JWT_ISSUER)
    .setAudience(overrides.audience ?? JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "30s")
    .setJti(overrides.jti ?? "jti-abc");

  return builder.sign(new TextEncoder().encode(overrides.secret ?? SECRET));
}

describe("verifyTelegramTokenJwt", () => {
  it("returns payload for a valid JWT", async () => {
    const token = await makeJwt({ sub: "user-42" });
    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toEqual({
      sub: "user-42",
      jti: "jti-abc",
      type: JWT_TYPE,
    });
  });

  it("returns null on bad signature (wrong secret)", async () => {
    const token = await makeJwt({ secret: "wrong-secret-please-replace-32" });
    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it("returns null when audience mismatches", async () => {
    const token = await makeJwt({ audience: "evil-audience" });
    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it("returns null when issuer mismatches", async () => {
    const token = await makeJwt({ issuer: "evil-issuer" });
    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it("returns null when type claim is wrong", async () => {
    const token = await makeJwt({ type: "evil-type" });
    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it("returns null when token is expired", async () => {
    // Negative exp → already-expired token.
    const token = await new SignJWT({
      sub: "user-1",
      jti: "j-1",
      type: JWT_TYPE,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .setJti("j-1")
      .sign(new TextEncoder().encode(SECRET));

    const payload = await verifyTelegramTokenJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it("returns null on empty / non-string token", async () => {
    expect(await verifyTelegramTokenJwt("", SECRET)).toBeNull();
    expect(await verifyTelegramTokenJwt(123 as unknown as string, SECRET)).toBeNull();
  });

  it("returns null on empty secret", async () => {
    const token = await makeJwt({});
    expect(await verifyTelegramTokenJwt(token, "")).toBeNull();
  });
});
