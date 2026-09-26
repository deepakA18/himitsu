import './globals.css';
import { WalletProvider } from '../components/wallet-provider';
export const metadata = {
  title: 'Himitsu · Local test app',
  description: 'Private note and frame-transaction testing',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
