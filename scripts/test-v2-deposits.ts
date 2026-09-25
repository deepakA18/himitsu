import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { keccak256, stringToHex, type Hex } from 'viem';
import { RpcClient } from '../packages/client/src/index';
import { readMarket } from '../packages/client/src/market';
const { send } = await import(process.cwd() + '/packages/protocol/ghost.mjs');
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8'));
assert.equal(d.noteVersion, 2);
const rpc = new RpcClient(d.rpcUrl);
const before = await readMarket(rpc, d.outputPool, 'accounted');
const balance = await readMarket(rpc, d.token, 'balanceOf', [d.outputPool]);
const tag = ('0x' + '01'.repeat(32)) as Hex;
send(d.token, 'transfer(address,uint256)', d.outputPool, '1');
assert.equal(await readMarket(rpc, d.token, 'balanceOf', [d.outputPool]), balance + 1n);
assert.throws(() => send(d.outputPool, 'depositCredited(bytes32)', tag));
assert.throws(() => send(d.outputPool, 'depositTokenAmount(bytes32,uint256)', tag, '1'));
assert.throws(() => send(d.outputPool, 'depositTokenAmount(bytes32,uint256)', tag, '0'));
assert.throws(() =>
  send(d.outputPool, 'depositTokenAmount(bytes32,uint256)', tag, String(1n << 128n)),
);
assert.equal(await readMarket(rpc, d.outputPool, 'accounted'), before);
const allowanceData = ('0x' +
  keccak256(stringToHex('allowance(address,address)')).slice(2, 10) +
  d.pool.slice(2).padStart(64, '0') +
  d.outputPool.slice(2).padStart(64, '0')) as Hex;
assert.equal(
  BigInt(await rpc.request<Hex>('eth_call', [{ to: d.token, data: allowanceData }, 'latest'])),
  0n,
);
const summary = {
  deployment: d.id,
  donationCannotMintCredit: true,
  freshTransferRequired: true,
  amountBoundsEnforced: true,
  swapAllowanceCleared: true,
};
writeFileSync('deployments/app.v2-deposit-evidence.json', JSON.stringify(summary, null, 2));
console.log(summary);
