'use client';

import { useEffect, useRef, useState } from 'react';
import type { Attempt } from '../../../packages/client/src/vault';
import styles from './transaction-notifications.module.css';

type Notice = { id: string; title: string; message: string; failure: boolean; hash?: string };
function describe(a: Attempt): Notice | null {
  const action = a.kind === 'withdraw' ? 'Withdrawal' : a.kind === 'swap' ? 'Swap' : 'Deposit';
  const base = { id: a.id, hash: a.hash, failure: false };
  switch (a.state) {
    case 'confirmed':
      return {
        ...base,
        title: `${action} confirmed`,
        message:
          a.kind === 'deposit'
            ? 'Your deposit is confirmed. Keep your saved private note to spend these funds.'
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
          'The transaction did not complete successfully. Check the transaction details and refresh your note status before retrying.',
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
        title: `${action} status uncertain`,
        message:
          'The network has not confirmed the outcome. Keep your notes and check the transaction; do not submit it again yet.',
      };
    case 'submitted':
    case 'broadcasting':
      return {
        ...base,
        title: `${action} pending`,
        message:
          'Waiting for network confirmation. Keep your saved notes; this is not yet a successful transaction.',
      };
    case 'mined':
      return {
        ...base,
        title: `${action} awaiting confirmation`,
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
}: {
  attempts: Attempt[];
  pool: string;
  error: string;
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
      if (notice) updates.push(notice);
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
            { id: 'action-error', title: 'Action could not finish', message: error, failure: true },
          ].slice(-4)
        : remaining;
    });
  }, [error]);
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
            <a
              href={`/explorer?tx=${encodeURIComponent(n.hash)}&pool=${encodeURIComponent(pool)}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
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
