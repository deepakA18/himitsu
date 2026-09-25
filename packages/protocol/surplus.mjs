import assert from 'node:assert/strict';
import {deploySystem,deployTokenPool,deployer,send,cast,RPC_URL,FUNDER,GUSD_DENOMINATION,createNote,toHex32,balanceOf} from './ghost.mjs';
const system=await deploySystem({withLegacySponsor:false,fundPool:false});
const token=deployer.deploySol('TestToken',{args:{signature:'constructor(uint256)',values:[(GUSD_DENOMINATION*10n).toString()]}});
const pool=deployTokenPool(system,token,GUSD_DENOMINATION,{fundPool:false});
const note=await createNote(),donation=GUSD_DENOMINATION;
send(token,'transfer(address,uint256)',pool,donation.toString());
function refused(...args){try{const r=send(...args);return r.status==='0x0';}catch{return true;}}
assert(refused(pool,'depositCredited(bytes32)',toHex32(note.commitment)),'legacy public surplus claim must revert');
assert(refused(pool,'depositToken(bytes32)',toHex32(note.commitment)),'a donation must not substitute for a fresh transfer');
assert.equal(cast('call','--rpc-url',RPC_URL,pool,'accounted()(uint256)'),'0');
send(token,'approve(address,uint256)',pool,GUSD_DENOMINATION.toString());
send(pool,'depositToken(bytes32)',toHex32(note.commitment));
assert.equal(balanceOf(token,pool),donation+GUSD_DENOMINATION);
assert.equal(BigInt(cast('call','--rpc-url',RPC_URL,pool,'accounted()(uint256)').split(' ')[0]),GUSD_DENOMINATION);
const another=await createNote();assert(refused(pool,'depositToken(bytes32)',toHex32(another.commitment)),'surplus still cannot back a second claim');
assert.equal(cast('call','--rpc-url',RPC_URL,pool,'nextIndex()(uint32)'),'1');
console.log('PASS: legacy surplus claim rejected; no-allowance claim rejected; fresh transfer credits exactly one note; donation remains unclaimed.');
process.exit(0);
