import type { ReactNode } from 'react';

/**
 * The icon set.
 *
 * Text symbols (`⌂`, `▦`, `◷`, `♡`, `○`) were used as icons across all four
 * surfaces. They come from whichever font happens to carry each codepoint, so a
 * row of five arrives at five different weights and optical sizes — and on the
 * Devanagari display face the house glyph rendered as a solid disc. These are
 * one stroke weight, one grid, and no font dependency at all.
 *
 * Every icon is decorative: the control around it carries the accessible name.
 */
function Glyph({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  return (
    <svg
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className="ns-icon"
      fill="none"
      focusable="false"
      role={label ? 'img' : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export type IconName =
  | 'home'
  | 'grid'
  | 'clock'
  | 'heart'
  | 'heart-filled'
  | 'person'
  | 'basket'
  | 'search'
  | 'pin'
  | 'close'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'star'
  | 'star-filled'
  | 'truck'
  | 'store'
  | 'leaf'
  | 'bottle'
  | 'sack'
  | 'loaf'
  | 'fish'
  | 'spray';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  grid: (
    <>
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
  ),
  'heart-filled': (
    <path
      d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"
      fill="currentColor"
    />
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  basket: (
    <>
      <path d="M3 8h18l-1.6 11.2A2 2 0 0 1 17.4 21H6.6a2 2 0 0 1-2-1.8z" />
      <path d="M8.5 8 12 3l3.5 5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  star: <path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 7 19.5l1-5.6-4-3.9 5.5-.8z" />,
  'star-filled': (
    <path
      d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 7 19.5l1-5.6-4-3.9 5.5-.8z"
      fill="currentColor"
    />
  ),
  truck: (
    <>
      <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  store: (
    <>
      <path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M3 9 5 4h14l2 5" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-7 5-12 14-13 1 9-4 14-11 14z" />
      <path d="M8 16c2-3 4-5 7-6.5" />
    </>
  ),
  bottle: (
    <>
      <path d="M10 3h4v3.5l2.2 2.8A3 3 0 0 1 17 11v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a3 3 0 0 1 .8-2l2.2-2.8z" />
      <path d="M7 14h10" />
    </>
  ),
  sack: (
    <>
      <path d="M8.5 3h7l-1.5 3.2A7 7 0 0 1 19 13v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a7 7 0 0 1 5-6.8z" />
      <path d="M9.5 12h5" />
    </>
  ),
  loaf: (
    <>
      <path d="M4 12a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M9 8V6.5M12 8V6M15 8V6.5" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c3-4 7-5.5 10-5.5S18.5 8 21 12c-2.5 4-5 5.5-8 5.5S6 16 3 12z" />
      <circle cx="16.5" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <path d="M3 12 6 9v6z" />
    </>
  ),
  spray: (
    <>
      <path d="M9 8h6v13H9z" />
      <path d="M10.5 8V4.5h3V8" />
      <path d="M17 4.5h1.5M17 7h1.5M17 9.5h1.5" />
    </>
  ),
};

/** A 1em, currentColor icon. Decorative unless given a `label`. */
export function Icon({ label, name }: { readonly name: IconName; readonly label?: string }) {
  return <Glyph {...(label === undefined ? {} : { label })}>{PATHS[name]}</Glyph>;
}
