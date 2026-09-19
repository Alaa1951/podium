import Screen from "@/screens/studio-people";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/studio/people/[id]">) { const { id } = await props.params; return Screen(id); }
