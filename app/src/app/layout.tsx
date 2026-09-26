import { SiteFooter } from '../components/site-footer';
import './globals.css';

export const metadata = {
  title: 'Himitsu · Your trade. Your secret.',
  description:
    'Trade from a private balance through Uniswap. No app-operated relayer. No exchange allowance. Powered by zero-knowledge proofs and Ethereum frame transactions.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
