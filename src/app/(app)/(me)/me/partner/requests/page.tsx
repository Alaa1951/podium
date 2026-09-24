import Screen from "@/screens/partner-finder";
export const dynamic = "force-dynamic";
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return Screen("requests", searchParams); }
