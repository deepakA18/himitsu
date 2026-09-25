import 'fake-indexeddb/auto';
import { expect,test } from 'bun:test';
import { IndexedVaultStore,Vault,type VaultData } from '../src/vault';
import { createSecretNote } from '../src/notes';
const password='test vault password 2026';
const store=()=>new IndexedVaultStore('test-'+crypto.randomUUID());
function withNote(data:VaultData){return {...data,notes:[{...createSecretNote(),id:crypto.randomUUID(),deployment:'test-deployment',pool:`0x${'11'.repeat(20)}` as const,createdAt:Date.now()}]};}
test('vault reload preserves secrets while stored data and backup remain encrypted',async()=>{
 const storage=store(),v=await Vault.open(storage,password),next=withNote(v.data);await v.save(next);
 const raw=JSON.stringify(await storage.read());expect(raw.includes(next.notes[0]!.secret)).toBe(false);expect(raw.includes('nullifier')).toBe(false);
 const reopened=await Vault.open(storage,password);expect(reopened.data).toEqual(next);
 const restored=await Vault.restore(store(),password,await v.backup());expect(restored.data).toEqual(next);
 await expect(Vault.open(storage,'wrong password')).rejects.toThrow('Wrong password');
});
test('tampered backup fails authentication and cannot replace existing vault',async()=>{
 const storage=store(),v=await Vault.open(storage,password),backup=JSON.parse(await v.backup());backup.revision++;
 await expect(Vault.restore(store(),password,JSON.stringify(backup))).rejects.toThrow('Wrong password');
 await expect(Vault.restore(storage,password,await v.backup())).rejects.toThrow('another tab');
});
test('two unlocked tabs cannot overwrite each other with stale state',async()=>{
 const storage=store(),a=await Vault.open(storage,password),b=await Vault.open(storage,password);
 await a.save(withNote(a.data));await expect(b.save(withNote(b.data))).rejects.toThrow('another tab');
 await b.reload();expect(b.data.notes).toEqual(a.data.notes);
});
test('invalid imported note cannot be persisted',async()=>{
 const v=await Vault.open(store(),password),next=withNote(v.data);next.notes[0]!.secret='0';await expect(v.save(next)).rejects.toThrow('commitment mismatch');expect(v.data.notes).toHaveLength(0);
});
