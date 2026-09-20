import Screen from "@/screens/partner-finder";
export const dynamic = "force-dynamic";
export default function Page(props: PageProps<"/me/partner">){return Screen("browse", props.searchParams);}
