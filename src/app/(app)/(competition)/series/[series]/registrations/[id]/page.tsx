import Screen from "@/screens/registrations";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/series/[series]/registrations/[id]">) { const {id}=await props.params; return Screen(props,id); }
