'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './classnames.js';
import { Icon } from './icons.js';

type FieldFrameProps = {
  readonly children: (ids: { readonly control: string; readonly described?: string }) => ReactNode;
  readonly label: ReactNode;
  readonly hint?: ReactNode | undefined;
  readonly error?: string | null | undefined;
  readonly className?: string | undefined;
  /** Hides the label visually but keeps it for assistive technology. */
  readonly labelHidden?: boolean | undefined;
};

/**
 * The label/hint/error frame every control shares.
 *
 * The apps were wrapping inputs in a bare `<label>` with the text as a sibling,
 * so a hint was never associated with the control and an error was announced
 * only if the user happened to be reading. `aria-describedby` is wired here
 * once (UX-04).
 */
export function FieldFrame({
  children,
  className,
  error,
  hint,
  label,
  labelHidden = false,
}: FieldFrameProps) {
  const base = useId();
  const control = `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('ns-field', error && 'ns-field--invalid', className)}>
      <label className={cx('ns-field__label', labelHidden && 'sr-only')} htmlFor={control}>
        {label}
      </label>
      {children(described === undefined ? { control } : { control, described })}
      {hint ? (
        <p className="ns-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ns-field__error" id={errorId}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'>;

export type FieldProps = NativeInput & {
  readonly label: ReactNode;
  readonly hint?: ReactNode | undefined;
  readonly error?: string | null | undefined;
  readonly className?: string | undefined;
  readonly labelHidden?: boolean | undefined;
};

/** A labelled text input. */
export function Field({ className, error, hint, label, labelHidden, ...rest }: FieldProps) {
  return (
    <FieldFrame
      className={className}
      error={error ?? null}
      hint={hint}
      label={label}
      labelHidden={labelHidden ?? false}
    >
      {(ids) => (
        <input
          {...rest}
          aria-describedby={ids.described}
          aria-invalid={error ? true : undefined}
          className="ns-input"
          id={ids.control}
        />
      )}
    </FieldFrame>
  );
}

type NativeSelect = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'>;

export type SelectFieldProps = NativeSelect & {
  readonly label: ReactNode;
  readonly hint?: ReactNode | undefined;
  readonly error?: string | null | undefined;
  readonly className?: string | undefined;
  readonly labelHidden?: boolean | undefined;
  readonly children: ReactNode;
};

/** A labelled native select — native because it is the only control that stays usable on a low-end phone. */
export function SelectField({
  children,
  className,
  error,
  hint,
  label,
  labelHidden,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldFrame
      className={className}
      error={error ?? null}
      hint={hint}
      label={label}
      labelHidden={labelHidden ?? false}
    >
      {(ids) => (
        <select
          {...rest}
          aria-describedby={ids.described}
          aria-invalid={error ? true : undefined}
          className="ns-select"
          id={ids.control}
        >
          {children}
        </select>
      )}
    </FieldFrame>
  );
}

export type SearchFieldProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly label: string;
  readonly placeholder?: string | undefined;
  readonly busy?: boolean | undefined;
  readonly className?: string | undefined;
  readonly submitLabel?: string | undefined;
};

/** A search input in its own form, so Enter submits on every platform. */
export function SearchField({
  busy = false,
  className,
  label,
  onChange,
  onSubmit,
  placeholder,
  submitLabel = 'Search',
  value,
}: SearchFieldProps) {
  return (
    <form
      className={cx('ns-search', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      role="search"
    >
      <span className="ns-search__glyph">
        <Icon name="search" />
      </span>
      <Field
        className="ns-search__field"
        label={label}
        labelHidden
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? ''}
        type="search"
        value={value}
      />
      <button
        className="ns-button ns-button--primary ns-button--medium"
        disabled={busy}
        type="submit"
      >
        <span className="ns-button__label">{submitLabel}</span>
      </button>
    </form>
  );
}

export type FilterChip = {
  readonly id: string;
  readonly label: string;
  readonly count?: number | undefined;
};

/**
 * A single-select filter row.
 *
 * A `radiogroup`, not a row of buttons: arrow keys move between options and the
 * selected one is announced as selected rather than as a pressed button.
 */
export function FilterChips({
  className,
  label,
  onSelect,
  options,
  selected,
}: {
  readonly label: string;
  readonly options: readonly FilterChip[];
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly className?: string | undefined;
}) {
  return (
    <div aria-label={label} className={cx('ns-chips', className)} role="radiogroup">
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <button
            aria-checked={active}
            className={cx('ns-chip', active && 'ns-chip--active')}
            key={option.id}
            onClick={() => onSelect(active ? null : option.id)}
            role="radio"
            type="button"
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="ns-chip__count"> {option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
