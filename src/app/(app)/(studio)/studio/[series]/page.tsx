import { redirect } from "next/navigation";

/** A competition opens on its teams — the tab a studio is here for. */
export default async function StudioSeriesIndex(props: PageProps<"/studio/[series]">) {
  const { series } = await props.params;
  redirect(`/studio/${series}/teams`);
}
