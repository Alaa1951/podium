import Screen from "@/screens/competitor";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/studio/[series]/teams/[id]/people/[personId]">) { return Screen(props.params,true); }
