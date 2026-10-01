import type { Metadata } from "next";

import Screen from "@/screens/waivers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Waiver Declarations", robots: { index: false, follow: false } };

export default function Page(props: PageProps<"/waivers">) {
  return Screen(props.searchParams);
}
