import { z } from "zod";
import { SOCIAL_FIELDS, isSocialUrl } from "@/lib/validation/site-content";

/**
 * The seller's business details (Settings → Business details). Every field is
 * optional, since they arrive over time; each is format-checked when given.
 * What's still missing is reported by the launch-readiness check, not here.
 */

/** Gujarat's GST state code: the first two digits of a Gujarat GSTIN. */
export const SELLER_GST_STATE_CODE = "24";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FSSAI = /^\d{14}$/;
/** A company's CIN (21 characters) or an LLP's LLPIN (AAA-1234). */
const CIN = /^([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}|[A-Z]{3}-\d{4})$/;
const PHONE = /^\+?[\d\s-]{8,16}$/;

const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalEmail = z.string().trim().email("Enter a valid email address.").optional();
const optionalPhone = z
  .string()
  .trim()
  .regex(PHONE, "Enter a phone number, e.g. 079 4000 1234 or +91 98765 43210.")
  .optional();

const optionalSocial = (hosts: readonly string[]) =>
  z.string().trim().max(300).refine((v) => isSocialUrl(v, hosts), `Use a full https:// link on ${hosts[0]}.`).optional();

export const businessProfileSchema = z
  .object({
    legalName: optionalText(200),
    tradeName: optionalText(200),
    registeredAddress: optionalText(500),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN, "A GSTIN is 15 characters, e.g. 24ABCDE1234F1Z5.")
      .optional(),
    fssaiLicence: z.string().trim().regex(FSSAI, "An FSSAI licence number is 14 digits.").optional(),
    customerCarePhone: optionalPhone,
    customerCareEmail: optionalEmail,
    grievanceOfficerName: optionalText(120),
    grievanceOfficerDesignation: optionalText(120),
    grievanceOfficerPhone: optionalPhone,
    grievanceOfficerEmail: optionalEmail,
    cin: z.string().trim().toUpperCase().regex(CIN, "A CIN is 21 characters, e.g. U15490GJ2024PTC123456 (or an LLPIN like AAB-1234).").optional(),
    mailingAddress: optionalText(500),
    instagramUrl: optionalSocial(SOCIAL_FIELDS[0].hosts),
    facebookUrl: optionalSocial(SOCIAL_FIELDS[1].hosts),
    xUrl: optionalSocial(SOCIAL_FIELDS[2].hosts),
    youtubeUrl: optionalSocial(SOCIAL_FIELDS[3].hosts),
  })
  .superRefine((p, ctx) => {
    // Invoices charge CGST+SGST on the basis that the seller is registered in
    // Gujarat; a GSTIN from another state would make every invoice wrong.
    if (p.gstin && !p.gstin.startsWith(SELLER_GST_STATE_CODE)) {
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: `This GSTIN isn't a Gujarat registration (Gujarat GSTINs start with ${SELLER_GST_STATE_CODE}).`,
      });
    }
  });

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const BUSINESS_FIELDS: readonly { name: keyof BusinessProfileInput; label: string; group: string; hint?: string }[] = [
  { name: "legalName", label: "Registered company name", group: "Company", hint: "As on your GST registration." },
  { name: "tradeName", label: "Trade name", group: "Company", hint: "Only if different, e.g. SooulOne." },
  { name: "registeredAddress", label: "Registered address", group: "Company" },
  { name: "gstin", label: "GSTIN", group: "Company" },
  { name: "fssaiLicence", label: "FSSAI licence number", group: "Company" },
  { name: "cin", label: "CIN", group: "Company", hint: "Corporate Identity Number, shown in the footer and on the Contact page." },
  { name: "mailingAddress", label: "Mailing address", group: "Company", hint: "Only if post should go somewhere other than the registered address." },
  { name: "customerCarePhone", label: "Customer care phone", group: "Customer care" },
  { name: "customerCareEmail", label: "Customer care email", group: "Customer care" },
  { name: "grievanceOfficerName", label: "Name", group: "Grievance officer", hint: "The E-Commerce Rules require this person to be named on the site." },
  { name: "grievanceOfficerDesignation", label: "Designation", group: "Grievance officer" },
  { name: "grievanceOfficerPhone", label: "Phone", group: "Grievance officer" },
  { name: "grievanceOfficerEmail", label: "Email", group: "Grievance officer" },
  ...SOCIAL_FIELDS.map((f) => ({ name: f.name, label: f.label, group: "SooulOne social profiles", hint: `Full link, e.g. https://www.${f.hosts[0]}/sooulone` })),
];
