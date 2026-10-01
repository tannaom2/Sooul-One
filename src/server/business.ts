import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { BUSINESS_TAG } from "@/lib/cache-tags";
import { withLastGood } from "@/server/last-good";

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
  cin: string | null;
  mailingAddress: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  youtubeUrl: string | null;
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
  cin: null,
  mailingAddress: null,
  instagramUrl: null,
  facebookUrl: null,
  xUrl: null,
  youtubeUrl: null,
};

const withEnvLicence = (profile: BusinessProfile): BusinessProfile => ({
  ...profile,
  fssaiLicence: profile.fssaiLicence ?? process.env.NEXT_PUBLIC_FSSAI_LICENCE_NUMBER ?? null,
});

const loadBusinessProfile = unstable_cache(
  async (): Promise<BusinessProfile> => {
    // Throws on a database error, so an empty profile is never cached (src/server/last-good.ts).
    const row = await db.businessProfile.findUnique({ where: { id: "default" } });
    return withEnvLicence({ ...EMPTY, ...(row ?? {}) });
  },
  ["business-profile"],
  { revalidate: 3600, tags: [BUSINESS_TAG] },
);

/**
 * The seller's business details, as the owner entered them on Settings →
 * Business details. Read on every storefront page (the footer), so it's
 * cached and expired when the owner saves. The FSSAI licence falls back to
 * NEXT_PUBLIC_FSSAI_LICENCE_NUMBER, where it lived before this existed.
 * A database error answers with the last details read on this server, and
 * with none, an empty profile for that request only: it's never cached, so
 * it can't stick to the footer, invoices or the launch gate for an hour.
 */
export const getBusinessProfile = withLastGood("business-profile", loadBusinessProfile, () => withEnvLicence(EMPTY));
