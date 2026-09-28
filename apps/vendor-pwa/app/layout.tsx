import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Anek_Devanagari, Noto_Sans } from 'next/font/google';
import '@neighbourhood-store/ui-tokens/tokens.css';
import '@neighbourhood-store/ui/styles.css';
import './globals.css';

// Self-hosted at build time: no third-party request at runtime, which keeps the
// installed PWA legible offline and cheap on a metered connection (UX-02).
// Both families include Devanagari, so Hindi and English share one set of
// metrics instead of falling back to an arbitrary system face (MKT-11).
const display = Anek_Devanagari({
  subsets: ['latin', 'devanagari'],
  weight: ['500', '600', '700'],
  variable: '--font-display-loaded',
  display: 'swap',
});

const body = Noto_Sans({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-loaded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Vendor · Neighbourhood Store',
  description: 'Run your store: orders, stock, catalogue and payouts in one place.',
};

// Without this Next 16 emits no viewport meta at all, so mobile browsers lay the
// page out at a virtual ~980px and scale it down: every max-width media query in
// the stylesheets silently never fires on a real phone (UX-01, UX-02).
// userScalable / maximumScale are deliberately left at their defaults — pinch
// zoom must keep working for UX-05 and WCAG 1.4.4.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#edf1eb',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body data-role="vendor">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
