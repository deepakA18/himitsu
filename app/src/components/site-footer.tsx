import Link from 'next/link';
import styles from './site-footer.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <nav aria-label="Footer navigation">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/app" prefetch={false}>Open app</Link>
        </nav>
      </div>
    </footer>
  );
}
