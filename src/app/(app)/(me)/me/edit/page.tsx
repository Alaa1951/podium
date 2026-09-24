import Screen from "@/screens/me";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ series?: string }> }) {
  const params = await searchParams; return Screen(true, typeof params.series === "string" ? params.series : undefined);
}
