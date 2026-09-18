"use client";
import { useState, type ReactNode } from "react";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";

/** Server-action forms keep their draft protected until successful navigation. */
export function DraftGuard({children}:{children:ReactNode}) {
  const [dirty,setDirty]=useState(false);
  useUnsavedChanges(dirty);
  return <div onInput={()=>setDirty(true)}>{children}</div>;
}
