import Screen from "@/screens/studio-scores";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/studio/[series]/scores/[id]">) { const {id}=await props.params; return Screen(props,id); }
