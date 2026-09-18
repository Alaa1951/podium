import Screen from "@/screens/roles";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return Screen(id,true);}
