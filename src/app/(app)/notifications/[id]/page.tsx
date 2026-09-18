import Screen from "@/screens/notifications";
export const dynamic="force-dynamic";
export default async function Page({params}:PageProps<"/notifications/[id]">){return Screen((await params).id);}
