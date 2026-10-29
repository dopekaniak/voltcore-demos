'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { Logo } from './Logo';

type Theme = 'system' | 'light' | 'dark';

function setThemeCookie(theme: Theme) {
  document.cookie = `sw_theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

const NAV = [
  { href: '/library', label: t.nav.library },
  { href: '/orders', label: t.nav.orders },
  { href: '/billing', label: t.nav.billing },
  { href: '/developers', label: t.nav.developers },
];

export function AppShell({ children, initialTheme }: { children: ReactNode; initialTheme: Theme }) {
  const { me, wallet, refresh } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && (createRef.current?.contains(e.target as Node) || accountRef.current?.contains(e.target as Node))) return;
      setCreateOpen(false);
      setAccountOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  useEffect(() => {
    setCreateOpen(false);
    setAccountOpen(false);
  }, [path]);

  const signOut = async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    await refresh();
    router.push('/');
  };
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  const menuItem = 'block rounded px-3 py-2 text-sm text-[var(--sw-text)] hover:bg-[var(--sw-surface)]';

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-[var(--sw-bg)] focus:px-3 focus:py-2">
        {t.nav.skip}
      </a>
      <header className="sticky top-0 z-40 border-b border-[var(--sw-border)] bg-[var(--sw-bg)]/95 backdrop-blur">
        <nav aria-label={t.nav.main} className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-[var(--sw-text)]">
            <Logo className="h-7 w-7" />
            <span>{t.brand.name}</span>
          </Link>
          <div className="ml-4 hidden items-center gap-1 md:flex">
            <div className="relative" ref={createRef}>
              <button type="button" aria-haspopup="menu" aria-expanded={createOpen} onClick={() => setCreateOpen((o) => !o)} className="rounded px-3 py-2 text-sm font-medium text-[var(--sw-text)] hover:bg-[var(--sw-surface)]">
                {t.nav.create} ▾
              </button>
              {createOpen ? (
                <div role="menu" className="absolute left-0 mt-1 w-52 rounded-md border border-[var(--sw-border)] bg-[var(--sw-bg)] p-1 shadow-lg">
                  <Link role="menuitem" href="/" className={menuItem}>{t.nav.describe}</Link>
                  <Link role="menuitem" href="/generate" className={menuItem}>{t.nav.generate}</Link>
                  <Link role="menuitem" href="/print" className={menuItem}>{t.nav.upload}</Link>
                </div>
              ) : null}
            </div>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined} className={`rounded px-3 py-2 text-sm ${isActive(n.href) ? 'font-semibold text-[var(--sw-accent)]' : 'text-[var(--sw-text)] hover:bg-[var(--sw-surface)]'}`}>
                {n.label}
              </Link>
            ))}
            {me && (me.role === 'ADMIN' || me.role === 'OPS') ? (
              <Link href="/admin" className="rounded px-3 py-2 text-sm text-[var(--sw-text)] hover:bg-[var(--sw-surface)]">{t.nav.admin}</Link>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {wallet ? (
              <Link href="/billing" className="rounded-full border border-[var(--sw-border)] px-3 py-1 font-mono text-xs tabular-nums text-[var(--sw-text)]" data-testid="credit-badge">
                {t.nav.credits(wallet.available)}
              </Link>
            ) : null}
            {me ? (
              <div className="relative" ref={accountRef}>
                <button type="button" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((o) => !o)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sw-surface-2)] text-sm font-semibold text-[var(--sw-text)]" aria-label={`${t.nav.account}: ${me.email}`}>
                  {(me.name ?? me.email).slice(0, 1).toUpperCase()}
                </button>
                {accountOpen ? (
                  <div role="menu" className="absolute right-0 mt-1 w-60 rounded-md border border-[var(--sw-border)] bg-[var(--sw-bg)] p-2 shadow-lg">
                    <p className="truncate px-3 py-1 text-xs text-[var(--sw-text-muted)]">{me.email}</p>
                    <label className="flex items-center justify-between px-3 py-2 text-sm text-[var(--sw-text)]">
                      {t.nav.theme}
                      <select
                        value={theme}
                        onChange={(e) => {
                          const v = e.target.value as Theme;
                          setTheme(v);
                          setThemeCookie(v);
                        }}
                        className="rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 py-1 text-sm"
                      >
                        {(['system', 'light', 'dark'] as const).map((o) => (
                          <option key={o} value={o}>{t.nav.themeOptions[o]}</option>
                        ))}
                      </select>
                    </label>
                    <button role="menuitem" type="button" onClick={signOut} className={`${menuItem} w-full text-left`}>
                      {t.nav.signOut}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link href={`/sign-in?next=${encodeURIComponent(path)}`} className="rounded-md bg-[var(--sw-accent)] px-3 py-1.5 text-sm font-medium text-[var(--sw-accent-contrast)]">
                {t.nav.signIn}
              </Link>
            )}
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:pb-10">
        {children}
      </main>
      <footer className="hidden border-t border-[var(--sw-border)] py-6 text-xs text-[var(--sw-text-muted)] md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4">
          <span>© Shapewright</span>
          <Link href="/legal/terms">{t.footer.terms}</Link>
          <Link href="/legal/privacy">{t.footer.privacy}</Link>
          <Link href="/legal/notices">{t.footer.notices}</Link>
          <Link href="/status">{t.footer.status}</Link>
        </div>
      </footer>
      {/* Mobile: bottom tabs */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--sw-border)] bg-[var(--sw-bg)] md:hidden">
        {[{ href: '/', label: t.nav.create }, ...NAV].map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(n.href) && (n.href !== '/' || path === '/') ? 'page' : undefined} className="flex h-14 items-center justify-center text-xs text-[var(--sw-text)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--sw-accent)]">
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
