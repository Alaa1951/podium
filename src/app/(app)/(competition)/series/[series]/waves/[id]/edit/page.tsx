import Screen from "@/screens/waves";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{series:string;id:string}>}){const {series,id}=await params;return Screen({params:Promise.resolve({series}),searchParams:Promise.resolve({})},id,true);}
