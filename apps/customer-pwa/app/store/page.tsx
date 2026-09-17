import { redirect } from 'next/navigation';

/** Backwards-compatible redirect for links created by the old Pages build. */
export default async function LegacyStorePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  redirect(location ? `/stores/${encodeURIComponent(location)}` : '/stores');
}
