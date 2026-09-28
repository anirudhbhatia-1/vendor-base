'use client';

import type { ReactNode } from 'react';
import { cx } from './classnames.js';
import { Skeleton } from './states.js';

export type DataTableColumn<Row> = {
  readonly key: string;
  readonly header: ReactNode;
  /** Right-aligns and sets tabular numerals — every money and count column. */
  readonly numeric?: boolean | undefined;
  readonly render: (row: Row) => ReactNode;
};

export type DataTableProps<Row> = {
  /** Names the table for assistive tech; rendered visually hidden. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Opens the row's object. Every operational row should lead somewhere. */
  readonly onOpen?: ((row: Row) => void) | undefined;
  /** Accessible name for a row's open control, e.g. `Open order SYNTH-1204`. */
  readonly openLabel?: ((row: Row) => string) | undefined;
  /** Shown in place of the body when there are no rows — an EmptyState. */
  readonly empty?: ReactNode | undefined;
  /** Keeps the last rows visible while a refresh is in flight. */
  readonly busy?: boolean | undefined;
  readonly className?: string | undefined;
};

/**
 * The operations table.
 *
 * Admin screens were rendering JSON dumps and rows of unlabelled `<div>`s; an
 * operations console reads as a real `<table>` or a screen reader user gets no
 * column context at all. Rows stay flat (no nested cards), keep the 44px admin
 * target, and — when `onOpen` is given — always lead to their object, because a
 * queue row that opens nothing is a dead end the operator retypes an ID from.
 */
export function DataTable<Row>({
  busy = false,
  caption,
  className,
  columns,
  empty,
  onOpen,
  openLabel,
  rowKey,
  rows,
}: DataTableProps<Row>) {
  if (rows.length === 0 && !busy) {
    return <div className={cx('ns-table-empty', className)}>{empty}</div>;
  }
  return (
    <div aria-busy={busy || undefined} className={cx('ns-table-scroll', className)}>
      <table className="ns-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={cx('ns-table__head', column.numeric && 'ns-table__cell--numeric')}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
            {onOpen ? (
              <th className="ns-table__head ns-table__head--open" scope="col">
                <span className="sr-only">Open</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="ns-table__cell" colSpan={columns.length + (onOpen ? 1 : 0)}>
                <Skeleton lines={3} variant="block" />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                className={cx('ns-table__row', onOpen && 'ns-table__row--interactive')}
                key={rowKey(row)}
                onClick={onOpen ? () => onOpen(row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    className={cx('ns-table__cell', column.numeric && 'ns-table__cell--numeric')}
                    key={column.key}
                  >
                    {column.render(row)}
                  </td>
                ))}
                {onOpen ? (
                  <td className="ns-table__cell ns-table__cell--open">
                    {/* The row's onClick is a convenience; this button is the
                        keyboard and screen-reader path to the same place. */}
                    <button
                      aria-label={openLabel ? openLabel(row) : 'Open'}
                      className="ns-icon-button ns-button--ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(row);
                      }}
                      title={openLabel ? openLabel(row) : 'Open'}
                      type="button"
                    >
                      <span aria-hidden="true">›</span>
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export type DescriptionItem = {
  readonly label: string;
  readonly value: ReactNode;
  readonly numeric?: boolean | undefined;
};

/**
 * Labelled facts about one object — what the admin screens were showing as
 * `JSON.stringify` in a `<pre>`. A real `<dl>`, so every value keeps its name.
 */
export function DescriptionList({
  className,
  items,
}: {
  readonly className?: string | undefined;
  readonly items: readonly DescriptionItem[];
}) {
  return (
    <dl className={cx('ns-facts', className)}>
      {items.map((item) => (
        <div className="ns-facts__row" key={item.label}>
          <dt className="ns-facts__label">{item.label}</dt>
          <dd className={cx('ns-facts__value', item.numeric && 'ns-table__cell--numeric')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
