import { z } from "zod";

/**
 * Suppliers and their FSSAI licences. Pure, so the rules are tested directly
 * (tests/suppliers.test.ts); reads and writes are in src/server/suppliers.ts.
 */

export const LICENCE_TYPES = {
  CENTRAL: "Central licence",
  STATE: "State licence",
  REGISTRATION: "Basic registration",
} as const;

export type LicenceType = keyof typeof LICENCE_TYPES;

/** An FSSAI licence or registration number: 14 digits, spaces and dashes ignored. */
export function cleanLicence(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export const isFssaiLicence = (value: string) => /^\d{14}$/.test(value);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the firm's name as on its licence.").max(200),
  address: z.string().trim().min(5, "Enter the address as on its licence.").max(500),
  fssaiLicence: z
    .string()
    .transform(cleanLicence)
    .refine((v) => v === "" || isFssaiLicence(v), "An FSSAI licence or registration number is 14 digits.")
    .transform((v) => (v === "" ? null : v)),
  licenceType: z.enum(["CENTRAL", "STATE", "REGISTRATION"]).nullable(),
  licenceExpiresOn: z.date().nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "A GSTIN is 15 characters, like 24AAKCS4821M1ZX.")
    .transform((v) => (v === "" ? null : v)),
  contactName: optionalText(120),
  contactPhone: optionalText(30),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Check the email address.")
    .transform((v) => (v === "" ? null : v)),
  notes: optionalText(1000),
  isActive: z.boolean(),
}).superRefine((s, ctx) => {
  // A licence number and its expiry belong together: a reminder needs the date.
  if (s.fssaiLicence && !s.licenceExpiresOn && s.licenceType !== "REGISTRATION") {
    ctx.addIssue({ code: "custom", path: ["licenceExpiresOn"], message: "Enter the date the licence expires, so you're reminded before it does." });
  }
  if (s.fssaiLicence && !s.licenceType) {
    ctx.addIssue({ code: "custom", path: ["licenceType"], message: "Choose the kind of licence." });
  }
});

export type SupplierInput = z.infer<typeof supplierSchema>;

export type LicenceStatus =
  | { readonly state: "missing" }
  | { readonly state: "expired"; readonly days: number }
  | { readonly state: "expiring"; readonly days: number }
  | { readonly state: "valid"; readonly days: number | null };

/** Days before expiry that the owner hears about it. */
export const REMIND_DAYS_BEFORE = [60, 14] as const;

const DAY = 86_400_000;

/** Where a supplier's licence stands today. "Expiring" means within the first reminder window. */
export function licenceStatus(s: { fssaiLicence: string | null; licenceExpiresOn: Date | null }, now: Date): LicenceStatus {
  if (!s.fssaiLicence) return { state: "missing" };
  if (!s.licenceExpiresOn) return { state: "valid", days: null };
  const days = Math.ceil((s.licenceExpiresOn.getTime() - now.getTime()) / DAY);
  if (days < 0) return { state: "expired", days: -days };
  if (days <= REMIND_DAYS_BEFORE[0]) return { state: "expiring", days };
  return { state: "valid", days };
}

/** Plain words for a licence's state, for the console. */
export function licenceLabel(status: LicenceStatus): string {
  switch (status.state) {
    case "missing":
      return "No FSSAI licence number";
    case "expired":
      return `Licence expired ${status.days} ${status.days === 1 ? "day" : "days"} ago`;
    case "expiring":
      return status.days === 0 ? "Licence expires today" : `Licence expires in ${status.days} ${status.days === 1 ? "day" : "days"}`;
    case "valid":
      return "Licence valid";
  }
}

/**
 * The reminders a licence expiring on this date gets, each with the day it
 * goes. Windows already passed collapse into one reminder now (the nearest
 * one), and a licence already expired gets a single alert now (daysBefore 0).
 */
export function licenceReminders(expiresOn: Date, now: Date): { daysBefore: number; sendAfter: Date }[] {
  const expiry = expiresOn.getTime();
  if (expiry <= now.getTime()) return [{ daysBefore: 0, sendAfter: now }];
  const windows = REMIND_DAYS_BEFORE.map((daysBefore) => ({ daysBefore, at: expiry - daysBefore * DAY }));
  const passed = windows.filter((w) => w.at <= now.getTime());
  const catchUp = passed.length ? [{ daysBefore: Math.min(...passed.map((w) => w.daysBefore)), sendAfter: now }] : [];
  return [...catchUp, ...windows.filter((w) => w.at > now.getTime()).map((w) => ({ daysBefore: w.daysBefore, sendAfter: new Date(w.at) }))];
}

/** The dedupe key for one reminder: a changed expiry date gets fresh reminders. */
export const licenceReminderKey = (supplierId: string, expiresOn: Date, daysBefore: number) =>
  `supplier_licence:${supplierId}:${expiresOn.toISOString().slice(0, 10)}:${daysBefore}`;

/**
 * Why a product can't go live with these suppliers, or null. The manufacturer
 * must be on file with a licence number, and so must a packer or marketer
 * when one is named (Labelling and Display Regs 2020, reg 5(7)(b)).
 */
export function liveLicenceProblem(
  manufacturer: { name: string; fssaiLicence: string | null } | null,
  marketer: { name: string; fssaiLicence: string | null } | null,
): { field: "manufacturerId" | "marketerId"; message: string } | null {
  if (!manufacturer) return { field: "manufacturerId", message: "Choose the manufacturer before this product goes live. Add it under Suppliers if it isn't listed." };
  if (!manufacturer.fssaiLicence) {
    return { field: "manufacturerId", message: `${manufacturer.name} has no FSSAI licence number. Add it under Suppliers before this product goes live.` };
  }
  if (marketer && !marketer.fssaiLicence) {
    return { field: "marketerId", message: `${marketer.name} has no FSSAI licence number. Add it under Suppliers before this product goes live.` };
  }
  return null;
}

/** "Lic. No. 10012345678901", as the label line reads. */
export const licenceLine = (licence: string) => `FSSAI Lic. No. ${licence}`;
