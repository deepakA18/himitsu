'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import type { Deployment } from '../../../packages/client/src/chain';
import styles from './wallet-provider.module.css';

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
    name: 'Himitsu',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
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
          // Keep ConnectKit's wallet UI without its optional embedded account SDK.
          // The local Ethrex flow uses external EIP-1193 wallets.
          enableFamily: false,
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
    async function loadDeployment() {
      let response = await fetch('/deployment.json', { cache: 'no-store' });
      if (!response.ok) {
        const catalogResponse = await fetch('/deployments.json', { cache: 'no-store' });
        if (!catalogResponse.ok) throw new Error('No app deployment is available.');
        const catalog = (await catalogResponse.json()) as { url: string }[];
        const defaultDeployment = catalog[0];
        if (!defaultDeployment?.url) throw new Error('No app deployment is available.');
        response = await fetch(defaultDeployment.url, { cache: 'no-store' });
      }
      if (!response.ok) throw new Error('The selected deployment could not be loaded.');
      return (await response.json()) as Deployment;
    }
    loadDeployment()
      .then((deployment) => {
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
      <main className={styles.screen} aria-busy={!error}>
        <div className={styles.content}>
          <div className={styles.brand} aria-label="Himitsu">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
              <path d="m13 2 6 28" stroke="#080808" strokeWidth="2" />
            </svg>
            himitsu
          </div>
          {error ? (
            <>
              <p role="alert" className={styles.error}>
                {error}
              </p>
              <button
                className={styles.retry}
                onClick={() => {
                  setError('');
                  setRetry((n) => n + 1);
                }}
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              <h1>Preparing your workspace</h1>
              <p className={styles.message} role="status">
                Connecting to the pool and wallet
              </p>
            </>
          )}
        </div>
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
