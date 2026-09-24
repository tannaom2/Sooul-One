import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { BUSINESS_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";

export interface BusinessProfile {
  legalName: string | null;
  tradeName: string | null;
  registeredAddress: string | null;
  gstin: string | null;
  fssaiLicence: string | null;
  customerCarePhone: string | null;
  customerCareEmail: string | null;
  grievanceOfficerName: string | null;
  grievanceOfficerDesignation: string | null;
  grievanceOfficerPhone: string | null;
  grievanceOfficerEmail: string | null;
}

const EMPTY: BusinessProfile = {
  legalName: null,
  tradeName: null,
  registeredAddress: null,
  gstin: null,
  fssaiLicence: null,
  customerCarePhone: null,
  customerCareEmail: null,
  grievanceOfficerName: null,
  grievanceOfficerDesignation: null,
  grievanceOfficerPhone: null,
  grievanceOfficerEmail: null,
};

/**
 * The seller's business details, as the owner entered them on Settings →
 * Business details. Read on every storefront page (the footer), so it's
 * cached and expired when the owner saves. The FSSAI licence falls back to
 * NEXT_PUBLIC_FSSAI_LICENCE_NUMBER, where it lived before this existed.
 * A database error gives an empty profile rather than breaking every page.
 */
export const getBusinessProfile = unstable_cache(
  async (): Promise<BusinessProfile> => {
    let row: Partial<BusinessProfile> | null = null;
    try {
      row = await db.businessProfile.findUnique({ where: { id: "default" } });
    } catch (error) {
      reportError("business-profile", error);
    }
    const profile = { ...EMPTY, ...(row ?? {}) };
    return { ...profile, fssaiLicence: profile.fssaiLicence ?? process.env.NEXT_PUBLIC_FSSAI_LICENCE_NUMBER ?? null };
  },
  ["business-profile"],
  { revalidate: 3600, tags: [BUSINESS_TAG] },
);
