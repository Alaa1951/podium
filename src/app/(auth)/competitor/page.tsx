import { redirect } from "next/navigation";

/** The old address of the athlete sign-in; links in emails and apps still use it. */
export default function CompetitorLoginPage() {
  redirect("/athlete");
}
