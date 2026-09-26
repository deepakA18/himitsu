import Link from 'next/link';
import styles from './site-footer.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <Link className={styles.brand} href="/" aria-label="Himitsu home">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
            <path d="m13 2 6 28" stroke="#080808" strokeWidth="2" />
          </svg>
          himitsu
        </Link>
        <nav aria-label="Footer navigation">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/app" prefetch={false}>Open app</Link>
        </nav>
      </div>
    </footer>
  );
}
