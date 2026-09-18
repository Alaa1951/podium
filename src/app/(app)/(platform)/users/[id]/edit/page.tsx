import Screen from "@/screens/users";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/users/[id]/edit">) {const {id}=await props.params; return Screen(id,true);}
