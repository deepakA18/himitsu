import type { Deployment } from '../../../packages/client/src/chain';
import type { Wallet } from './controller';

function isUnknownChain(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (value.code === 4902) return true;
  if (typeof value.message === 'string' && /unknown chain|unrecognized chain/i.test(value.message))
    return true;
  return value.cause ? isUnknownChain(value.cause) : false;
}

/** Select the deployment's chain, adding it to the wallet if needed. */
export async function selectWalletNetwork(wallet: Wallet, deployment: Deployment) {
  const chainId = Number(deployment.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error('The configured network has an invalid chain ID.');
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (error) {
    if (!isUnknownChain(error)) throw error;
    await wallet.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hexChainId,
          chainName: 'Himitsu',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [deployment.rpcUrl],
          blockExplorerUrls: [
            typeof window === 'undefined' ? '/explorer' : `${window.location.origin}/explorer`,
          ],
        },
      ],
    });
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  }
}
