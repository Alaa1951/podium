import { requireUser } from "@/lib/session";

/**
 * Everything below this layout needs an account. `requireUser` redirects to
 * /login when there is no active session, so no child page has to check first.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <>{children}</>;
}
