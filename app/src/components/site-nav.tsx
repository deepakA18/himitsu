import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './site-nav.module.css';

export function SiteNav({ page, wallet }: { page: 'home' | 'app' | 'explorer'; wallet?: ReactNode }) {
  const home = page === 'home' ? '' : '/';
  return (
    <header className={page === 'home' ? styles.nav + ' ' + styles.landingNav : styles.nav}>
      {page === 'app' ? <span className={styles.brand}>
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
          <path d="m13 2 6 28" stroke="#080808" strokeWidth="2" />
        </svg>
        himitsu<span className={styles.japanese}>秘密</span>
      </span> : <Link
        className={styles.brand}
        href="/"
        aria-label="Himitsu home"
        aria-current={page === 'home' ? 'page' : undefined}
      >
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
          <path d="m13 2 6 28" stroke="#080808" strokeWidth="2" />
        </svg>
        himitsu<span className={styles.japanese}>秘密</span>
      </Link>}
      {page !== 'app' && <nav className={styles.links} aria-label="Main navigation">
        <Link href={`${home}#how-it-works`}>How it works</Link>
        <Link href={`${home}#why-himitsu`}>Why Himitsu</Link>
        <Link href="/explorer" aria-current={page === 'explorer' ? 'page' : undefined}>
          Explorer
        </Link>
        <Link href={`${home}#faq`}>FAQ</Link>
      </nav>}
      {page === 'app' ? wallet ?? null : page === 'home' && (
        <Link className={styles.action} href="/app" prefetch={false}>
          Launch app
        </Link>
      )}
    </header>
  );
}
