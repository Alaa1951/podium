import { ApprovalsSection } from "@/components/approvals/approvals-section";
import { getTranslator } from "@/lib/i18n/server";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * SIGN-UPS WAITING FOR APPROVAL.
 *
 * Everyone who signed up and proved their email, oldest first. Requests that
 * named a studio also show on that studio's People screen; whoever acts first
 * decides. Only BFT MENA decides a request to become a Gym/Studio.
 */
export default async function ApprovalsPage() {
  const user = await requireAccess("approvals.view");
  const { t } = await getTranslator();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Approvals")}</h1>
          <p>
            {t(
              "People who signed up and are waiting to be let in. Until they are approved they see the general pages only."
            )}
          </p>
        </div>
      </div>
      <ApprovalsSection user={user} />
    </div>
  );
}
