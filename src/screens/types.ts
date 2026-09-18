export type SeriesScreenProps = {
  params: Promise<{ series: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
