import { z } from "zod";

export const channelKindEnum = z.enum([
  "TELEGRAM",
  "EMAIL",
  "WHATSAPP",
  "MAX",
  "IMESSAGE",
  "SMS",
  "PUSH",
  "VK",
]);

const e164 = /^\+?[1-9]\d{6,14}$/;

export const addChannelSchema = z
  .object({
    kind: channelKindEnum,
    address: z.string().trim().min(1).max(200),
    label: z.string().trim().max(80).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "EMAIL") {
      const ok = z.string().email().safeParse(v.address).success;
      if (!ok) ctx.addIssue({ code: "custom", path: ["address"], message: "invalid email" });
    } else if (v.kind === "SMS" || v.kind === "WHATSAPP") {
      if (!e164.test(v.address))
        ctx.addIssue({ code: "custom", path: ["address"], message: "phone must be E.164" });
    }
  });

export const verifyChannelSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});

const hhmm = /^\d{2}:\d{2}$/;

export const globalPreferenceSchema = z.object({
  timezone: z.string().trim().min(1).max(60).optional(),
  quietHoursFrom: z.string().regex(hhmm).nullable().optional(),
  quietHoursTo: z.string().regex(hhmm).nullable().optional(),
  dndUntil: z.coerce.date().nullable().optional(),
});

export const eventPreferenceSchema = z.object({
  eventType: z.string().trim().min(1).max(80),
  enabled: z.boolean().optional(),
  channelKinds: z.array(channelKindEnum).max(8).optional(),
  quietHoursFrom: z.string().regex(hhmm).nullable().optional(),
  quietHoursTo: z.string().regex(hhmm).nullable().optional(),
  quietWeekdaysOnly: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  dndUntil: z.coerce.date().nullable().optional(),
});
