import { homeForUser, requireUser } from "@/lib/session";
import { ViewAsBanner } from "@/components/app/view-as-banner";
import { PersonalMobileNavigation } from "@/components/app/mobile-navigation";

/**
 * Everything below this layout needs an account. `requireUser` redirects to
 * /login when there is no active session, so no child page has to check first.
 *
 * When that account is an admin holding a preview ("view as") cookie, the
 * banner travels above every screen — there is no corner of the app where the
 * preview can be mistaken for the admin's own view, or where the way out is
 * missing.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      {user.viewAs ? <ViewAsBanner name={user.name} role={user.role} /> : null}
      {children}
      <PersonalMobileNavigation role={user.role} homeHref={await homeForUser(user)} />
    </>
  );
}
