'use client';

import { StatusPill, type StatusPillProps } from '@neighbourhood-store/ui';
import { useLocale } from './locale';

/**
 * A `StatusPill` wired to the customer's language.
 *
 * The shared component carries the whole state vocabulary — `PLACED`,
 * `AWAITING_CUSTOMER_DECISION`, `RETURN_AUTHORIZED` — with a stable locale key
 * per state. This hands it the surface's translator so those words are Hindi
 * when the rest of the screen is, rather than an English island in the middle
 * of a translated page.
 */
export function StatePill(props: Omit<StatusPillProps, 'translate'>) {
  const { t } = useLocale();
  return <StatusPill {...props} translate={t} />;
}
