export interface LinkRequestResult {
  sent: boolean;
  maskedValue: string;
  expiresIn: number;
}

export interface LinkConfirmResult {
  linked: boolean;
  user: {
    id: string;
    name: string | null;
    role: string;
    telegramId: string;
  };
  token: string;
}

export interface DeepLinkResult {
  linked: boolean;
  userName: string | null;
}

export interface GenerateLinkResult {
  deepLink: string;
  expiresIn: number;
  expiresAt: string;
}

export interface OtpData {
  userId: string;
  type: "email" | "phone";
  value: string;
  code: string;
  attempts: number;
}
