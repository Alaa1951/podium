import Screen from "@/screens/studio-teams";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/studio/[series]/teams/[id]/edit">) { const {id}=await props.params; return Screen(props,id,true); }
