/**
 * What a financial correction does to the books, before anyone posts it (10.6).
 *
 * A correction reverses the original posting whole and posts its replacement,
 * so its effect on any account is the replacement's net less the original's.
 * An account that names an owner -- a vendor's or a partner's payable -- is
 * reported per owner: that is the participant a correction moves money for or
 * against. The impact is the money that changes hands: the sum of the
 * increases, which equals the sum of the decreases because both postings
 * balance. It is what the approval threshold is measured against, rather than
 * the size of the replacement alone, which says nothing about how far it
 * moves from the original.
 */
export type ImpactEntry = {
  readonly account_reference: string;
  readonly debit_minor: number;
  readonly credit_minor: number;
  readonly vendor_location_id?: string | null | undefined;
  readonly partner_user_id?: string | null | undefined;
};

export type ImpactRow = {
  readonly account_reference: string;
  readonly vendor_location_id: string | null;
  readonly partner_user_id: string | null;
  /** The original posting's net debit on this account and owner. */
  readonly before_debit_minor: number;
  /** The replacement's net debit on it. */
  readonly after_debit_minor: number;
  /** After less before: positive is a debit the correction adds. */
  readonly change_debit_minor: number;
};

export type CorrectionImpact = {
  readonly rows: readonly ImpactRow[];
  readonly impact_minor: number;
};

export class CorrectionImpactError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

function paise(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new CorrectionImpactError(`${label} must be non-negative integer paise`);
  return value;
}

export function correctionImpact(
  original: readonly ImpactEntry[],
  replacement: readonly ImpactEntry[],
): CorrectionImpact {
  const nets = new Map<
    string,
    { row: Omit<ImpactRow, 'change_debit_minor'>; before: number; after: number }
  >();
  const add = (entry: ImpactEntry, side: 'before' | 'after') => {
    const vendor = entry.vendor_location_id ?? null;
    const partner = entry.partner_user_id ?? null;
    const key = JSON.stringify([entry.account_reference, vendor, partner]);
    const found = nets.get(key) ?? {
      row: {
        account_reference: entry.account_reference,
        vendor_location_id: vendor,
        partner_user_id: partner,
        before_debit_minor: 0,
        after_debit_minor: 0,
      },
      before: 0,
      after: 0,
    };
    found[side] += paise(entry.debit_minor, 'Debit') - paise(entry.credit_minor, 'Credit');
    nets.set(key, found);
  };
  for (const entry of original) add(entry, 'before');
  for (const entry of replacement) add(entry, 'after');
  const rows = [...nets.values()]
    .map(({ row, before, after }) =>
      Object.freeze({
        ...row,
        before_debit_minor: before,
        after_debit_minor: after,
        change_debit_minor: after - before,
      }),
    )
    .filter((row) => row.change_debit_minor !== 0)
    .sort((left, right) =>
      JSON.stringify([left.account_reference, left.vendor_location_id, left.partner_user_id]) <
      JSON.stringify([right.account_reference, right.vendor_location_id, right.partner_user_id])
        ? -1
        : 1,
    );
  const increases = rows.reduce((sum, row) => sum + Math.max(0, row.change_debit_minor), 0);
  const decreases = rows.reduce((sum, row) => sum + Math.max(0, -row.change_debit_minor), 0);
  if (increases !== decreases)
    throw new CorrectionImpactError('A correction and its original must each balance');
  return Object.freeze({ rows: Object.freeze(rows), impact_minor: increases });
}
