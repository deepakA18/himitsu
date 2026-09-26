import { WalletProvider } from '../../components/wallet-provider';

export const metadata = { title: 'Himitsu · Private swap' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
