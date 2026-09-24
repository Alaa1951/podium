import { FIELD, readField, type CrmContact } from "./field-map.ts";

type Person = {
  name: string | null; email: string | null; phone: string | null; birth: string | null;
  gender: string | null; shirt: string | null; member: string | null; studio: string | null;
};

export function normalizeCrmPhone(value: string | null | undefined): string | null {
  let digits = value?.replace(/\D/g, "") ?? "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `974${digits}`;
  return digits || null;
}

export function crmBirthDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = /^\d{11,}$/.test(value) ? new Date(Number(value)) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid CRM birth date");
  return date.toISOString().slice(0, 10);
}

const email = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

function people(contact: CrmContact): [Person, Person] {
  return [{
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.contactName || null,
    email: email(contact.email), phone: contact.phone || null, birth: crmBirthDate(contact.dateOfBirth),
    gender: readField(contact, FIELD.genderOne), shirt: readField(contact, FIELD.shirtOne),
    member: readField(contact, FIELD.bftMemberOne), studio: readField(contact, FIELD.studioOne),
  }, {
    name: readField(contact, FIELD.nameTwo), email: email(readField(contact, FIELD.emailTwo)),
    phone: readField(contact, FIELD.phoneTwo), birth: crmBirthDate(readField(contact, FIELD.birthTwo)),
    gender: readField(contact, FIELD.genderTwo), shirt: readField(contact, FIELD.shirtTwo),
    member: readField(contact, FIELD.bftMemberTwo), studio: readField(contact, FIELD.studioTwo),
  }];
}

function samePerson(a: Person, b: Person): boolean {
  if (!a.email || a.email !== b.email) return false;
  const ap = normalizeCrmPhone(a.phone), bp = normalizeCrmPhone(b.phone);
  if (ap && bp && ap !== bp) throw new Error("Matching email has conflicting phone numbers");
  return true;
}

function enrich(base: Person, other: Person): Person {
  for (const key of ["birth", "gender", "shirt", "member", "studio"] as const) {
    if (base[key] && other[key] && base[key] !== other[key]) throw new Error(`Conflicting ${key} for the same athlete`);
  }
  return Object.fromEntries(Object.entries(base).map(([key, value]) =>
    [key, value || other[key as keyof Person]])) as Person;
}

/** Consolidate registration answers around the payer, without writing money or identity. */
export function planPaidRegistrationMerge(input: {
  team: { name: string; category: string; division: string };
  registration: CrmContact; payer: CrmContact; other: CrmContact;
}) {
  const { team, registration, payer, other } = input;
  const seats = people(registration);
  if (!seats[0].email || !seats[1].email || seats[0].email === seats[1].email)
    throw new Error("Two distinct athlete emails are required for a reviewed merge");
  const payerPerson = people(payer)[0];
  const payerIndex = seats.findIndex((seat) => samePerson(seat, payerPerson));
  if (payerIndex < 0) throw new Error("Payer is not on the registered team");
  const partnerIndex = 1 - payerIndex;
  if (!samePerson(seats[partnerIndex], people(other)[0])) throw new Error("Retired contact is not the other athlete");
  let one = enrich(payerPerson, seats[payerIndex]);
  let two = seats[partnerIndex];
  for (const contact of [registration, payer, other]) {
    for (const person of people(contact)) {
      if (samePerson(one, person)) one = enrich(one, person);
      if (samePerson(two, person)) two = enrich(two, person);
    }
  }
  const category = ({ Mens: "MEN", Womens: "WOMEN", Mixed: "MIXED" } as Record<string, string>)[team.category];
  if (!category || !["Rookie", "Open", "Pro"].includes(team.division)) throw new Error("Invalid team bracket");
  const fields: { id: string; value: string | string[] }[] = [
    { id: FIELD.teamName, value: team.name }, { id: FIELD.category, value: [category] },
    { id: FIELD.division, value: [team.division.toUpperCase()] }, { id: FIELD.havePartner, value: "Yes" },
  ];
  function put(id: string, value: string | null, many = false) {
    if (value) fields.push({ id, value: many ? [value] : value });
  }
  put(FIELD.genderOne, one.gender); put(FIELD.shirtOne, one.shirt);
  put(FIELD.bftMemberOne, one.member, true); put(FIELD.studioOne, one.studio, true);
  put(FIELD.nameTwo, two.name); put(FIELD.emailTwo, two.email); put(FIELD.phoneTwo, two.phone);
  put(FIELD.birthTwo, two.birth); put(FIELD.genderTwo, two.gender); put(FIELD.shirtTwo, two.shirt);
  put(FIELD.bftMemberTwo, two.member, true); put(FIELD.studioTwo, two.studio, true);
  return {
    body: { customFields: fields, ...(one.birth ? { dateOfBirth: one.birth } : {}) },
    payerEmail: one.email!, partnerEmail: two.email!, payerPositionInTeam: payerIndex + 1,
    payment: { amount: readField(payer, FIELD.paidAmount), invoice: readField(payer, FIELD.invoice) },
  };
}
