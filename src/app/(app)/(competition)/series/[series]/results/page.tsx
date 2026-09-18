import Screen from "@/screens/competition-results";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/series/[series]/results">) { return Screen(props); }
