import Screen from "@/screens/approvals";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/approvals">) { return Screen(await props.searchParams); }
