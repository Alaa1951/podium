import Screen from "@/screens/competition-scores";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/series/[series]/scores/[id]">) { const {id}=await props.params; return Screen(props,id); }
