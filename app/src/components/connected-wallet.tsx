'use client';

import { Avatar, ConnectKitButton } from 'connectkit';
import styles from './site-nav.module.css';

export function ConnectedWallet({ fallbackAddress }: { fallbackAddress: `0x${string}` }) {
  return (
    <ConnectKitButton.Custom>
      {({ show, address, truncatedAddress }) => (
        <button
          type="button"
          className={styles.wallet}
          onClick={() => show?.()}
          aria-label={`Connected wallet ${address ?? fallbackAddress}; open wallet options`}
          title={address ?? fallbackAddress}
        >
          <Avatar address={address ?? fallbackAddress} size={30} radius={15} />
          <span className={styles.walletAddress}>
            {truncatedAddress ?? `${fallbackAddress.slice(0, 6)}…${fallbackAddress.slice(-4)}`}
          </span>
          <svg className={styles.walletMenu} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="m3.5 5.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
