"use client";

import { useEffect, useState } from "react";

/** Seconds left on a server-given wait, ticking down once a second. */
export function useCountdown(initial = 0): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, (seconds: number) => setLeft(Math.max(0, Math.ceil(seconds)))];
}
