import { AnnouncementsPage } from "@/components/announcements/announcements-page";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){return AnnouncementsPage((await params).id);}
