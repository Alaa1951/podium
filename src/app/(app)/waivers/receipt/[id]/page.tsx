import type { Metadata } from "next";

import Screen from "@/screens/waiver-receipt";

export const dynamic = "force-dynamic";
// A signed record: never indexed, never cached by a shared proxy.
export const metadata: Metadata = { title: "Waiver receipt", robots: { index: false, follow: false } };

export default function Page(props: PageProps<"/waivers/receipt/[id]">) {
  return Screen(props.params);
}
