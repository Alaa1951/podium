import Screen from "@/screens/studios";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return Screen(id,false);}
