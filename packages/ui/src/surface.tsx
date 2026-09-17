'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from './classnames.js';
import { Icon } from './icons.js';

export type CardProps = {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** `sunken` is a row inside a card; `floating` lifts off the canvas. */
  readonly tone?: 'raised' | 'sunken' | 'floating' | undefined;
  readonly as?: 'article' | 'div' | 'li' | 'section' | undefined;
};

/** The one container. Replaces `.marketplace-panel`, `.storefront`, `.catalogue-flag`. */
export function Card({ as = 'div', children, className, tone = 'raised' }: CardProps) {
  const Tag = as;
  return <Tag className={cx('ns-card', `ns-card--${tone}`, className)}>{children}</Tag>;
}

export type PanelProps = {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly title: ReactNode;
  readonly eyebrow?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  /**
   * Heading level, so a page keeps one h1 and a real outline (UX-04).
   *
   * Level 1 is allowed because on several routes the panel *is* the page, and
   * a page whose only region starts at h2 has no h1 at all.
   */
  readonly level?: 1 | 2 | 3 | 4 | undefined;
  readonly id?: string | undefined;
};

/** A titled region: heading, optional supporting copy, optional actions. */
export function Panel({
  actions,
  children,
  className,
  description,
  eyebrow,
  id,
  level = 2,
  title,
}: PanelProps) {
  const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className={cx('ns-panel', className)} aria-labelledby={headingId} id={id}>
      <header className="ns-panel__header">
        <div className="ns-panel__titles">
          {eyebrow ? <p className="ns-eyebrow">{eyebrow}</p> : null}
          <Heading className="ns-panel__title" id={headingId}>
            {title}
          </Heading>
          {description ? <p className="ns-panel__description">{description}</p> : null}
        </div>
        {actions ? <div className="ns-panel__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export type SheetProps = {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
  readonly footer?: ReactNode | undefined;
  readonly className?: string | undefined;
};

/**
 * A bottom sheet on a phone and a centred dialog on a wide screen.
 *
 * Built on `<dialog showModal>` so focus trapping, the top layer, inert
 * background and Escape all come from the platform rather than from a hand-
 * rolled keyboard trap that would inevitably leak focus (UX-03).
 */
export function Sheet({ children, className, footer, onClose, open, title }: SheetProps) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-label={title}
      className={cx('ns-sheet', className)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialog}
    >
      <div className="ns-sheet__grabber" aria-hidden="true" />
      <header className="ns-sheet__header">
        <h2 className="ns-sheet__title">{title}</h2>
        <button aria-label="Close" className="ns-icon-button" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      <div className="ns-sheet__body">{children}</div>
      {footer ? <footer className="ns-sheet__footer">{footer}</footer> : null}
    </dialog>
  );
}
