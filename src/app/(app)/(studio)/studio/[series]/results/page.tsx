import Screen from "@/screens/studio-results";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/studio/[series]/results">) { return Screen(props); }
