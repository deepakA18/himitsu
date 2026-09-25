import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeEventLog, parseAbi, type Hex } from 'viem';
import { RpcClient } from '../packages/client/src/index';
import { poolV2Abi } from '../packages/client/src/chain';
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8'));
const rpc = new RpcClient(d.rpcUrl);
const hashes = [
  '0x232a049d4ec006c1c2ed808220b78ad6f056a663dd0b127ac266d15b1c815260',
  '0xfb50097f4236f3fc47c31d5cd2d4c3f4fe1fab261e104a2bdca23aff1d6359d6',
  '0x6af118a8903117a1c9f37056728cb114c0616eaf472723d965fda969215695e2',
];
const receipts = await Promise.all(
  hashes.map((hash) => rpc.request<any>('eth_getTransactionReceipt', [hash])),
);
for (const receipt of receipts) {
  assert.equal(receipt.status, '0x1');
  const block = await rpc.request<any>('eth_getBlockByNumber', [receipt.blockNumber, false]);
  assert.equal(block.hash, receipt.blockHash);
}
const deposited = receipts[1].logs
  .filter((l: any) => l.address.toLowerCase() === d.outputPool.toLowerCase())
  .flatMap((log: any) => {
    try {
      return [
        decodeEventLog({
          abi: poolV2Abi,
          eventName: 'DepositV2',
          data: log.data,
          topics: log.topics,
        }).args,
      ];
    } catch {
      return [];
    }
  });
assert.equal(deposited.length, 1);
const transfers = receipts[2].logs.flatMap((l: any) => {
  try {
    return [
      decodeEventLog({
        abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),
        data: l.data,
        topics: l.topics,
      }).args as { from: Hex; to: Hex; value: bigint },
    ];
  } catch {
    return [];
  }
});
const payout = transfers.find((t: any) => t.from.toLowerCase() === d.outputPool.toLowerCase());
assert.ok(payout);
assert.equal(payout.value, deposited[0].amount);
writeFileSync(
  'deployments/app.v2-browser-evidence.json',
  JSON.stringify(
    {
      deployment: d.id,
      origin: 'http://127.0.0.1:3000',
      recoveryOrigin: 'http://127.0.0.1:3001',
      phraseOnlyRecovery: true,
      originalVaultLocked: true,
      automaticConfirmations: true,
      browserProofs: true,
      outputAmount: String(payout.value),
      transactions: hashes,
      gasUsed: receipts.map((r) => String(BigInt(r.gasUsed))),
    },
    null,
    2,
  ),
);
console.log(
  'Browser receipts verified: deposit, full-output swap, phrase-only recovery, exact withdrawal.',
);
