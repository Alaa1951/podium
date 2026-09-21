import Screen from "@/screens/partner-watch";
export const dynamic = "force-dynamic";
export default function Page(props: PageProps<"/series/[series]/partners">){return Screen(props.params, false);}
