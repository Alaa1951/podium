"use client";
import { usePathname, useRouter } from "next/navigation";
import { StudioTeamEditor } from "@/components/studio/studio-team-editor";
import type { StudioTeamRow } from "@/components/studio/studio-teams-table";
export function RegistrationEditor({row,studios}:{row:StudioTeamRow;studios:{id:string;name:string}[]}){const router=useRouter(),path=usePathname();return <StudioTeamEditor row={row} studios={studios} canChooseDivision onDone={()=>{router.replace(path.replace(/\/edit$/,""));router.refresh();}} />;}
