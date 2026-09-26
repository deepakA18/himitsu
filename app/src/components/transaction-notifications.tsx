'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Attempt } from '../../../packages/client/src/vault';
import styles from './transaction-notifications.module.css';

type Notice = { id: string; title: string; message: string; failure: boolean; hash?: string; expiresAt?: number };
function describe(a: Attempt): Notice | null {
  const action =
    a.kind === 'withdraw'
      ? 'Withdrawal'
      : a.kind === 'swap-withdraw'
        ? 'Swap and withdrawal'
        : a.kind === 'swap'
          ? 'Swap'
          : 'Deposit';
  const base = { id: a.id, hash: a.hash, failure: false };
  switch (a.state) {
    case 'confirmed':
      return {
        ...base,
        title: `${action} confirmed`,
        message:
          a.kind === 'deposit'
            ? 'Your deposit is confirmed. Keep your saved private note to spend these funds.'
            : a.kind === 'swap-withdraw'
              ? 'Your swap is confirmed and the output was sent to the recipient address.'
              : a.kind === 'swap'
              ? 'Your swap is confirmed. Import your saved output note to use the received balance.'
              : 'Your withdrawal is confirmed. The tokens were sent to the recipient address.',
      };
    case 'failed':
      return {
        ...base,
        failure: true,
        title: `${action} failed`,
        message:
          a.detail || 'The transaction did not complete successfully. Check the transaction details and refresh your note status before retrying.',
      };
    case 'conflict':
      return {
        ...base,
        failure: true,
        title: `${action} could not complete`,
        message:
          'Another transaction used this nonce or spent this note. Refresh its status before taking another action.',
      };
    case 'expired':
      return {
        ...base,
        failure: true,
        title: `${action} expired`,
        message:
          'The transaction deadline passed without confirmation. Refresh your note status before preparing a new transaction.',
      };
    case 'unknown':
      return {
        ...base,
        title: 'Transaction pending',
        message:
          'The network has not confirmed the outcome. Keep your notes and check the transaction; do not submit it again yet.',
      };
    case 'broadcasting':
      return {
        ...base,
        title: 'Transaction pending',
        message: a.detail || 'Preparing the transaction for submission. Keep your saved note.',
      };
    case 'submitted':
      return {
        ...base,
        title: 'Transaction pending',
        message:
          'Waiting for network confirmation. Keep your saved notes; this is not yet a successful transaction.',
      };
    case 'mined':
      return {
        ...base,
        title: 'Transaction pending',
        message:
          'The transaction was included in a block. Checking confirmations and note settlement.',
      };
    default:
      return null;
  }
}

export function TransactionNotifications({
  attempts,
  pool,
  error,
  status,
  busy,
  returnTo,
}: {
  attempts: Attempt[];
  pool: string;
  error: string;
  status: { id: number; message: string };
  busy: string;
  returnTo: string;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const mountedAt = useRef(Date.now());
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    const updates: Notice[] = [];
    for (const attempt of attempts) {
      const signature = `${attempt.state}:${attempt.hash ?? ''}`;
      const previous = seen.current.get(attempt.id);
      if (previous === signature) continue;
      seen.current.set(attempt.id, signature);
      // Imported historical successes are history, not newly completed actions.
      if (
        !previous &&
        attempt.createdAt < mountedAt.current &&
        ['confirmed', 'failed', 'conflict', 'expired'].includes(attempt.state)
      )
        continue;
      const notice = describe(attempt);
      if (notice) updates.push({ ...notice, expiresAt: ['confirmed', 'failed', 'conflict', 'expired'].includes(attempt.state) ? Date.now() + 10000 : undefined });
    }
    if (updates.length)
      setNotices((current) =>
        [...current.filter((n) => !updates.some((u) => u.id === n.id)), ...updates].slice(-4),
      );
  }, [attempts]);
  useEffect(() => {
    setNotices((current) => {
      const remaining = current.filter((n) => n.id !== 'action-error');
      return error
        ? [
            ...remaining,
            { id: 'action-error', title: 'Action could not finish', message: error, failure: true, expiresAt: Date.now() + 10000 },
          ].slice(-4)
        : remaining;
    });
  }, [error]);
  useEffect(() => {
    setNotices((current) => {
      const remaining = current.filter((notice) => notice.id !== 'action-status');
      if (!status.message) return remaining;
      return [...remaining, {
        id: 'action-status',
        title: status.message.startsWith('Cancelled.') ? 'Cancelled' : 'Update',
        message: status.message.replace(/^Cancelled\.\s*/, ''),
        failure: false,
        expiresAt: Date.now() + 6000,
      }].slice(-4);
    });
  }, [status]);
  useEffect(() => {
    setNotices((current) => {
      const remaining = current.filter((notice) => notice.id !== 'action-progress');
      return busy ? [...remaining, {
        id: 'action-progress', title: 'In progress', message: busy, failure: false,
      }].slice(-4) : remaining;
    });
  }, [busy]);
  useEffect(() => {
    const expirations = notices.flatMap((notice) => notice.expiresAt ? [notice.expiresAt] : []);
    if (!expirations.length) return;
    const timer = setTimeout(() => {
      setNotices((current) => current.filter((notice) => !notice.expiresAt || notice.expiresAt > Date.now()));
    }, Math.max(0, Math.min(...expirations) - Date.now()));
    return () => clearTimeout(timer);
  }, [notices]);
  return (
    <aside className={styles.stack} aria-label="Transaction notifications">
      {notices.map((n) => (
        <div className={styles.notice} key={n.id}>
          <div role={n.failure ? 'alert' : 'status'} aria-atomic="true">
            <strong>
              {n.failure ? '× ' : ''}
              {n.title}
            </strong>
            <p>{n.message}</p>
          </div>
          {n.hash && (
            <Link
              href={`/explorer?tx=${encodeURIComponent(n.hash)}&pool=${encodeURIComponent(pool)}&returnTo=${encodeURIComponent(returnTo)}`}
              prefetch={false}
              onClick={() => window.history.replaceState(window.history.state, '', returnTo)}
            >
              View transaction →
            </Link>
          )}
          <button
            className={styles.dismiss}
            type="button"
            aria-label={`Dismiss ${n.title.toLowerCase()} notification`}
            onClick={() => setNotices((current) => current.filter((x) => x.id !== n.id))}
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
