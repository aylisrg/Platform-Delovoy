/**
 * Novofon API HTTP client.
 * Knows only about HTTP protocol — no business logic, no DB.
 * See: https://novofon.com/api
 *
 * Novofon uses JSON-RPC 2.0 on their Data API endpoint,
 * and a separate Call API for initiating calls.
 */

const NOVOFON_CALL_API_BASE = "https://api.novofon.com/v1";
const NOVOFON_DATA_API_BASE = "https://dataapi-jsonrpc.novofon.ru/2.0";

export interface NovofonCallRequest {
  /** SIP line ID or manager phone number (caller side) */
  from: string;
  /** Client phone number (callee side) */
  to: string;
  /** Displayed caller ID (virtual number) */
  caller_id?: string;
}

export interface NovofonCallResponse {
  success: boolean;
  call_id?: string;
  error?: string;
}

export interface NovofonAccountStatus {
  configured: boolean;
  balance?: string;
  error?: string;
}

/**
 * Initiate an outbound call via Novofon start.employee_call.
 * Novofon first calls `from` (manager's SIP/phone), then when picked up, connects to `to`.
 */
export async function novofonStartCall(
  apiKey: string,
  params: NovofonCallRequest
): Promise<NovofonCallResponse> {
  try {
    const res = await fetch(`${NOVOFON_CALL_API_BASE}/start.employee_call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        ...(params.caller_id && { caller_id: params.caller_id }),
      }),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      success: data.success === true || data.status === "success",
      call_id:
        (data.call_id as string | undefined) ??
        (data.callid as string | undefined),
      error:
        (data.error as string | undefined) ??
        (data.message as string | undefined),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Check if the Novofon API is reachable and the key is valid.
 * Uses Data API (JSON-RPC 2.0) to fetch account info.
 */
export async function novofonCheckStatus(
  apiKey: string
): Promise<NovofonAccountStatus> {
  if (!apiKey) {
    return { configured: false, error: "API key not set" };
  }

  try {
    const res = await fetch("https://dataapi-jsonrpc.novofon.ru/2.0", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "account.get_balance",
        params: {},
        id: 1,
      }),
    });

    if (!res.ok) {
      return { configured: false, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as {
      result?: { balance?: string };
      error?: { message?: string };
    };
    if (data.error) {
      return { configured: false, error: data.error.message };
    }

    return {
      configured: true,
      balance: data.result?.balance,
    };
  } catch (err) {
    return {
      configured: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Verify HMAC-SHA256 signature from Novofon webhook.
 * Returns true if signature is valid.
 */
export async function verifyNovofonSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body)
    );

    const expectedHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison to avoid timing attacks
    const receivedHex = signature.replace(/^sha256=/, "");
    if (expectedHex.length !== receivedHex.length) return false;

    let diff = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      diff |= expectedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
