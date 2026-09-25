import { assertHex } from '../../frame-codec/src/index';
import { validateSecretNote, type SavedNote } from './notes';
import type { Hex } from 'viem';
export type AttemptState = 'prepared' | 'broadcasting' | 'submitted' | 'unknown' | 'mined' | 'confirmed' | 'failed' | 'conflict' | 'expired';
export interface Attempt {
  id: string; deployment: string; kind: 'deposit' | 'swap' | 'withdraw'; source: string; output?: string;
  sender: Hex; nonce?: string; deadline?: string; raw?: Hex; hash?: Hex; state: AttemptState; createdAt: number; detail?: string;
}
export interface VaultData { version: 1; notes: SavedNote[]; attempts: Attempt[]; testWalletKey?: Hex; }
export interface Envelope { format: 'himitsu-vault'; version: 1; revision: number; salt: string; iv: string; ciphertext: string; }
export interface VaultStore { read(): Promise<Envelope | undefined>; compareAndSet(expected: number | null, value: Envelope): Promise<void>; }
const ITERATIONS = 310000;
const encode = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const decode = (s: string) => { if (typeof s !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(s)) throw new Error('Invalid encrypted backup'); return Uint8Array.from(s.match(/../g)!, h => parseInt(h, 16)); };
function envelope(value: unknown): Envelope {
  const e = value as Envelope;
  if (!e || e.format !== 'himitsu-vault' || e.version !== 1 || !Number.isSafeInteger(e.revision) || e.revision < 0 || typeof e.ciphertext !== 'string' || e.ciphertext.length > 10_000_000 || decode(e.salt).length !== 16 || decode(e.iv).length !== 12) throw new Error('Unsupported vault backup');
  decode(e.ciphertext); return e;
}
function validate(data: VaultData) {
  if (data?.version !== 1 || !Array.isArray(data.notes) || !Array.isArray(data.attempts) || data.notes.length > 4096 || data.attempts.length > 16384) throw new Error('Invalid vault data');
  if (data.testWalletKey) assertHex(data.testWalletKey,32);
  const ids = new Set<string>();
  for (const n of data.notes) { validateSecretNote(n); assertHex(n.pool, 20); if (typeof n.id !== 'string' || ids.has(n.id) || typeof n.deployment !== 'string' || !Number.isSafeInteger(n.createdAt)) throw new Error('Invalid note record'); ids.add(n.id); }
  const attemptIds = new Set<string>();
  for (const a of data.attempts) {
    if (typeof a.id !== 'string' || attemptIds.has(a.id) || !ids.has(a.source) || (a.output && !ids.has(a.output)) || !['deposit','swap','withdraw'].includes(a.kind) || !['prepared','broadcasting','submitted','unknown','mined','confirmed','failed','conflict','expired'].includes(a.state) || typeof a.deployment !== 'string' || !Number.isSafeInteger(a.createdAt)) throw new Error('Invalid attempt record');
    attemptIds.add(a.id); assertHex(a.sender,20); if (a.hash) assertHex(a.hash,32); if (a.raw) assertHex(a.raw);
    for (const v of [a.nonce,a.deadline]) if (v !== undefined && !/^\d+$/.test(v)) throw new Error('Invalid attempt number');
    if (a.kind !== 'deposit' && (!a.raw || !a.hash || a.nonce === undefined || a.deadline === undefined)) throw new Error('Incomplete frame attempt');
  }
}
async function derive(password: string, salt: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: decode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
const aad = (revision: number) => new TextEncoder().encode(`himitsu-vault:1:${revision}`);
async function decrypt(e: Envelope, key: CryptoKey) {
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(e.iv), additionalData: aad(e.revision) }, key, decode(e.ciphertext)); }
  catch { throw new Error('Wrong password or damaged backup'); }
  const data = JSON.parse(new TextDecoder().decode(plain)) as VaultData; validate(data); return data;
}
async function encrypt(data: VaultData, key: CryptoKey, salt: string, revision: number): Promise<Envelope> {
  validate(data); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(revision) }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { format:'himitsu-vault', version:1, revision, salt, iv:encode(iv), ciphertext:encode(new Uint8Array(ciphertext)) };
}
export class Vault {
  private constructor(readonly store: VaultStore, private key: CryptoKey, private saved: Envelope, public data: VaultData) {}
  static async open(store: VaultStore, password: string) {
    const saved = await store.read();
    if (saved) { envelope(saved); const key = await derive(password, saved.salt); return new Vault(store, key, saved, await decrypt(saved, key)); }
    if (password.length < 12) throw new Error('Use a vault password of at least 12 characters');
    const salt = encode(crypto.getRandomValues(new Uint8Array(16))), key = await derive(password,salt), data: VaultData = { version:1, notes:[], attempts:[] };
    const fresh = await encrypt(data,key,salt,0); await store.compareAndSet(null,fresh); return new Vault(store,key,fresh,data);
  }
  static async restore(store: VaultStore, password: string, text: string) {
    if (text.length > 10_000_000) throw new Error('Backup too large');
    const saved = envelope(JSON.parse(text)), key = await derive(password,saved.salt), data = await decrypt(saved,key);
    await store.compareAndSet(null,saved); return new Vault(store,key,saved,data);
  }
  async reload() { const saved = await this.store.read(); if (!saved || saved.salt !== this.saved.salt) throw new Error('Vault changed; lock and unlock again'); const data = await decrypt(envelope(saved),this.key); this.saved = saved; this.data = data; }
  async save(next: VaultData) { const fresh = await encrypt(next,this.key,this.saved.salt,this.saved.revision+1); await this.store.compareAndSet(this.saved.revision,fresh); this.saved=fresh; this.data=structuredClone(next); }
  async backup() { await this.reload(); return JSON.stringify(this.saved,null,2); }
}
export class IndexedVaultStore implements VaultStore {
  constructor(private name = 'himitsu-vault-v1') {}
  private db(): Promise<IDBDatabase> { return new Promise((resolve,reject) => { const req=indexedDB.open(this.name,1); req.onupgradeneeded=()=>req.result.createObjectStore('vault'); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  async read(): Promise<Envelope | undefined> { const db=await this.db(); return new Promise((resolve,reject)=>{ const tx=db.transaction('vault','readonly'), req=tx.objectStore('vault').get('document'); tx.oncomplete=()=>{db.close();resolve(req.result);}; tx.onerror=()=>{db.close();reject(tx.error);}; }); }
  async compareAndSet(expected: number | null, value: Envelope): Promise<void> {
    const db=await this.db(); return new Promise((resolve,reject)=>{
      const tx=db.transaction('vault','readwrite',{durability:'strict'}), store=tx.objectStore('vault'), req=store.get('document'); let conflict=false;
      req.onsuccess=()=>{ const current=req.result as Envelope|undefined; if ((current?.revision ?? null)!==expected) {conflict=true;tx.abort();} else store.put(value,'document'); };
      tx.oncomplete=()=>{db.close();resolve();}; tx.onabort=tx.onerror=()=>{db.close();reject(new Error(conflict?'Vault changed in another tab. Refresh before continuing.':'Could not durably save the vault'));};
    });
  }
}
export const isActive = (a: Attempt) => !['confirmed','failed','conflict','expired'].includes(a.state);
