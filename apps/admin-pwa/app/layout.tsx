import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@neighbourhood-store/ui-tokens/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Admin · Neighbourhood Store',
  description: 'Internal admin PWA shell for local company development.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="role-operations">{children}</body>
    </html>
  );
}
