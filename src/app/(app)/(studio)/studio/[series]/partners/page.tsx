import Screen from "@/screens/partner-watch";
export const dynamic = "force-dynamic";
export default function Page(props: PageProps<"/studio/[series]/partners">){return Screen(props.params, true);}
