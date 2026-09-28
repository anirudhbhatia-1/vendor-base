'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button.js';
import { Field, SelectField } from './field.js';
import { Notice } from './states.js';
import { Sheet } from './surface.js';

export type ConfirmReason = {
  readonly code: string;
  readonly label: string;
};

export type ConfirmDialogProps = {
  readonly open: boolean;
  /** Names the decision, e.g. `Refund ₹240 to the customer`. */
  readonly title: string;
  /** States the consequence in full sentences before the choice is made. */
  readonly children?: ReactNode | undefined;
  readonly tone?: 'danger' | 'primary' | undefined;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  /** The action is running; both buttons hold and the dialog stays. */
  readonly busy?: boolean | undefined;
  /** The action failed; shown inside the dialog so the context survives. */
  readonly error?: string | null | undefined;
  /** When given, the operator must pick one before confirming (reason-required action). */
  readonly reasons?: readonly ConfirmReason[] | undefined;
  readonly reasonLabel?: string | undefined;
  /** When given, a free-text note is collected; required unless marked optional. */
  readonly noteLabel?: string | undefined;
  readonly noteOptional?: boolean | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (input: { readonly note?: string; readonly reason_code?: string }) => void;
};

/**
 * The decision modal (design.md §12): a confirmed, reasoned action.
 *
 * It never auto-dismisses — only Cancel, a completed action, or Escape closes
 * it — and it states the consequence before asking. Admin approve, reject,
 * refund and override actions go through this instead of acting on first
 * click, and the reason select replaces free-typed reason codes.
 */
export function ConfirmDialog({
  busy = false,
  cancelLabel = 'Cancel',
  children,
  confirmLabel,
  error,
  noteLabel,
  noteOptional = false,
  onCancel,
  onConfirm,
  open,
  reasonLabel = 'Reason',
  reasons,
  title,
  tone = 'primary',
}: ConfirmDialogProps) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const needsReason = Boolean(reasons && reasons.length > 0);
  const needsNote = Boolean(noteLabel) && !noteOptional;
  const incomplete = (needsReason && reasonCode === '') || (needsNote && note.trim() === '');

  const close = () => {
    if (busy) return;
    setReasonCode('');
    setNote('');
    onCancel();
  };

  return (
    <Sheet
      className="ns-confirm"
      footer={
        <div className="ns-confirm__actions">
          <Button disabled={busy} onClick={close} size="large" variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            busy={busy}
            disabled={incomplete}
            onClick={() =>
              onConfirm({
                ...(needsReason ? { reason_code: reasonCode } : {}),
                ...(noteLabel && note.trim() !== '' ? { note: note.trim() } : {}),
              })
            }
            size="large"
            variant={tone === 'danger' ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </div>
      }
      onClose={close}
      open={open}
      title={title}
    >
      {children ? <div className="ns-confirm__consequence">{children}</div> : null}
      {needsReason ? (
        <SelectField
          label={reasonLabel}
          onChange={(event) => setReasonCode(event.currentTarget.value)}
          value={reasonCode}
        >
          <option disabled value="">
            Choose a reason
          </option>
          {reasons?.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {reason.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      {noteLabel ? (
        <Field
          hint={noteOptional ? 'Optional' : undefined}
          label={noteLabel}
          onChange={(event) => setNote(event.currentTarget.value)}
          value={note}
        />
      ) : null}
      {error ? (
        <Notice live="assertive" tone="danger">
          {error}
        </Notice>
      ) : null}
    </Sheet>
  );
}
