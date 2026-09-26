import styles from './trade.module.css';
import { WalletProvider } from '../../components/wallet-provider';

export const metadata = { title: 'Himitsu · Private swap demo' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.trade}>
      <WalletProvider>{children}</WalletProvider>
    </div>
  );
}
