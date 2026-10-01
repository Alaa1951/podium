"use client";
import { usePathname, useRouter } from "next/navigation";
import { StudioTeamEditor } from "@/components/studio/studio-team-editor";
import type { StudioTeamRow } from "@/components/studio/studio-teams-table";
/** BFT MENA's edit form. Full access (`canCorrectIdentity`) corrects any athlete's name and email — see staff-membership.ts. */
export function RegistrationEditor({row,studios,canCorrectIdentity=false}:{row:StudioTeamRow;studios:{id:string;name:string}[];canCorrectIdentity?:boolean}){const router=useRouter(),path=usePathname();return <StudioTeamEditor row={row} studios={studios} canChooseDivision canCorrectIdentity={canCorrectIdentity} onDone={()=>{router.replace(path.replace(/\/edit$/,""));router.refresh();}} />;}
