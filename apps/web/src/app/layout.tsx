import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { t } from '@/lib/messages';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = { title: { default: t.brand.name, template: `%s · ${t.brand.name}` }, description: t.brand.tagline };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('sw_theme')?.value;
  const initial = theme === 'light' || theme === 'dark' ? theme : 'system';
  await headers(); // opt into per-request rendering so the CSP nonce applies
  return (
    <html lang="en" {...(initial !== 'system' ? { 'data-theme': initial } : {})}>
      <body>
        <SessionProvider>
          <AppShell initialTheme={initial}>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
