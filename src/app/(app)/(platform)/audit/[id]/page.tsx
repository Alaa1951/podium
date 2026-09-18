import Screen from "@/screens/audit";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){return Screen({searchParams:Promise.resolve({})},(await params).id);}
