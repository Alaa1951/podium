import Screen from "@/screens/notifications";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:PageProps<"/notifications">){const search=await searchParams;return Screen(undefined,typeof search.cursor==="string"?search.cursor:undefined);}
