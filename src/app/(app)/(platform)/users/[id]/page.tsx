import Screen from "@/screens/users";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/users/[id]">) {const {id}=await props.params; return Screen(id,false);}
