import Screen from "@/screens/competitor";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/series/[series]/registrations/[id]/people/[personId]">) { return Screen(props.params,false); }
