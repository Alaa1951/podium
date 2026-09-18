import Screen from "@/screens/settings";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{series:string;id?:string}>}){const {series}=await params;return Screen({params:Promise.resolve({series}),searchParams:Promise.resolve({})},"new",true);}
