export function writeEvent(
  event: string,
  metadata: Readonly<Record<string, boolean | number | string | null>> = {},
): void {
  process.stdout.write(`${JSON.stringify({ event, ...metadata })}\n`);
}
