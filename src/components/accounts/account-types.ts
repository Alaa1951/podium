export type AccountType = "admin" | "staff" | "studio" | "competitor" | "organiser";

/** The account type, in words — keys of the translation table. */
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  admin: "BFT MENA · Full access",
  staff: "BFT MENA · Partial access",
  studio: "Gym / Studio",
  organiser: "Organiser",
  competitor: "Athlete",
};
