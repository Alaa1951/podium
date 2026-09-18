import Screen from "@/screens/my-wave";
export const dynamic = "force-dynamic";
export default async function Page(props: PageProps<"/my-wave/[id]">) { const {id}=await props.params; return Screen(id); }
