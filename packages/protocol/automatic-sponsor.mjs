import { buildPaymaster, SPONSOR_CALLDATA } from './generated/paymaster.mjs';
import { cast, RPC_URL, iface, rpc, send } from './ghost.mjs';

export async function deployAutomaticSponsor(pools, { funding = '0.1ether', amountBound = false, withdrawalsOnly = false } = {}) {
  const policy = {
    chainId: BigInt(await rpc('eth_chainId')),
    pools: pools.map(address => ({ address, verifySelector: amountBound ? cast('sig', 'validateSpend(bytes32,bytes32,address,uint256)') : iface.validateSpend, verifyCalldataBytes: amountBound ? 132 : 100,
      executeSelector: iface.spend, executeCalldataBytes: 4,
      additionalExecutions: withdrawalsOnly ? [] : [{ selector: amountBound ? cast('sig', 'spendAndSwapQuoted(address,uint256,address,bytes32)') : iface.spendAndSwapToNote, calldataBytes: amountBound ? 132 : 164 }] })),
    expiryVerifier: '0x0000000000000000000000000000000000008141',
    maxTransactionCost: 20_000_000_000_000_000n,
    maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, proofBytes: 256,
    budgets: [
      { execution: { min: 5000n, max: 5000n }, state: { min: 0n, max: 0n } },
      { execution: { min: 500000n, max: 500000n }, state: { min: 0n, max: 0n } },
      { execution: { min: 50000n, max: 50000n }, state: { min: 0n, max: 0n } },
      { execution: { min: 200000n, max: 900000n }, state: { min: 300000n, max: 1500000n } },
    ],
  };
  const artifact = buildPaymaster(policy);
  const deployed = send('--create', artifact.initCode);
  const sponsor = deployed.contractAddress;
  if (cast('code', '--rpc-url', RPC_URL, sponsor).toLowerCase() !== artifact.runtime.toLowerCase()) throw new Error('Paymaster runtime mismatch');
  if (funding !== null) send('--value', funding, sponsor);
  return { sponsor, sponsorCalldata: SPONSOR_CALLDATA, automaticSponsor: true, sponsorRuntimeHash: artifact.runtimeHash, sponsorPolicy: policy };
}
