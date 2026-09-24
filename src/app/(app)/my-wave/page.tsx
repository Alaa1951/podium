import Screen from "@/screens/my-wave";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ series?: string }> }) { const params = await searchParams; return Screen(undefined, typeof params.series === "string" ? params.series : undefined); }
