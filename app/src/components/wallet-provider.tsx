'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import type { Deployment } from '../../../packages/client/src/chain';

const DeploymentContext = createContext<Deployment | null>(null);
export function useWalletDeployment() {
  const deployment = useContext(DeploymentContext);
  if (!deployment) throw new Error('Wallet deployment is not loaded');
  return deployment;
}
function walletConfig(d: Deployment) {
  const id = Number(d.chainId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid deployment chain ID');
  const chain = defineChain({
    id,
    name: 'Himitsu Ethrex devnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
    testnet: true,
  });
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  // Without a project ID, use injected wallet discovery only. Never ship a fake WC ID.
  return projectId
    ? createConfig(
        getDefaultConfig({
          chains: [chain],
          transports: { [id]: http(d.rpcUrl) },
          ssr: true,
          walletConnectProjectId: projectId,
          appName: 'Himitsu',
          appDescription: 'Private-note swaps using native frame transactions',
          appUrl: window.location.origin,
        }),
      )
    : createConfig({
        chains: [chain],
        transports: { [id]: http(d.rpcUrl) },
        connectors: [injected()],
        multiInjectedProviderDiscovery: true,
        ssr: true,
      });
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [loaded, setLoaded] = useState<{
    deployment: Deployment;
    config: ReturnType<typeof walletConfig>;
  } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/deployment.json', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok)
          throw new Error('Deployment unavailable. Start the app with an existing deployment.');
        const deployment = (await r.json()) as Deployment;
        if (!cancelled) setLoaded({ deployment, config: walletConfig(deployment) });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Wallet setup failed');
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);
  if (!loaded)
    return (
      <main>
        <h1>Himitsu</h1>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button
              onClick={() => {
                setError('');
                setRetry((n) => n + 1);
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <p role="status">Loading pool and wallet connections…</p>
        )}
      </main>
    );
  return (
    <DeploymentContext.Provider value={loaded.deployment}>
      <WagmiProvider config={loaded.config}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider options={{ hideBalance: true }}>{children}</ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentContext.Provider>
  );
}
