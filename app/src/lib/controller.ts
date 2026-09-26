import {
  readiness,
  fundingRequired,
  minimumOutput,
  type Readiness,
} from '../../../packages/client/src/market';
import {
  recoveryKey,
  recoveryCandidates,
  deriveNote,
  nextCounter,
} from '../../../packages/client/src/recovery';
import {
  createWalletClient,
  defineChain,
  http,
  encodeFunctionData,
  isAddress,
  keccak256,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { RpcClient } from '../../../packages/client/src/index';
import {
  snapshot,
  reconciled,
  contractRead,
  poolAbi,
  poolV2Abi,
  type Deployment,
  type Snapshot,
  type Block,
} from '../../../packages/client/src/chain';
import {
  Vault,
  IndexedVaultStore,
  isActive,
  type Attempt,
} from '../../../packages/client/src/vault';
import {
  type SavedNote,
  hex32,
  withAmount,
  validateSecretNote,
} from '../../../packages/client/src/notes';
import {
  serializeTransaction,
  signingHash,
  digestLimbs,
  type FrameTransaction,
} from '../../../packages/frame-codec/src/index';
export interface Wallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export class Controller {
  readonly rpc: RpcClient;
  current: Snapshot | null = null;
  health: Readiness | null = null;
  constructor(
    readonly deployment: Deployment,
    readonly vault: Vault,
    private readonly prove: typeof browserProof = browserProof,
  ) {
    this.rpc = new RpcClient(deployment.rpcUrl);
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (!navigator.locks)
      throw new Error('This browser needs Web Locks support for safe multi-tab use');
    return navigator.locks.request('himitsu-vault-actions', async () => {
      await this.vault.reload();
      return fn();
    });
  }
  async refresh() {
    return this.exclusive(async () => {
      const result = await this.sync();
      this.health = await readiness(this.rpc, this.deployment);
      return result;
    });
  }
  private async requireReady(
    action: 'deposit' | 'swap' | 'withdrawal',
    sourcePool?: Hex,
    inputAmount?: string,
  ) {
    this.health = await readiness(this.rpc, this.deployment, sourcePool, inputAmount);
    const issues = this.health[`${action}Issues`];
    if (issues.length) throw new Error(issues.join('. '));
  }
  private candidates?: { phrase: string; key: CryptoKey; notes: SavedNote[] };
  private async sync() {
    const recovery = this.vault.data.recovery;
    if (recovery?.confirmed && this.candidates?.phrase !== recovery.phrase) {
      const key = await recoveryKey(recovery.phrase);
      const notes = [
        ...(await recoveryCandidates(key, this.deployment.id, this.deployment.pool)),
        ...(await recoveryCandidates(key, this.deployment.id, this.deployment.outputPool)),
      ];
      this.candidates = { phrase: recovery.phrase, key, notes };
    }
    const saved = this.vault.data.notes;
    const known = new Set(
      saved.map(
        (n) => n.deployment + ':' + n.pool.toLowerCase() + ':' + (n.baseCommitment ?? n.commitment),
      ),
    );
    const candidates = recovery?.confirmed
      ? (this.candidates?.notes ?? []).filter(
          (n) =>
            !known.has(
              n.deployment + ':' + n.pool.toLowerCase() + ':' + (n.baseCommitment ?? n.commitment),
            ),
        )
      : [];

    const s = await snapshot(
      this.rpc,
      this.deployment,
      [...saved, ...candidates],
      this.vault.data.attempts,
    );
    const recovered = (n: SavedNote) =>
      s.pools.get(n.pool.toLowerCase())?.recovered?.get(n.id) ?? n;
    const notes = [
      ...saved.map(recovered),
      ...candidates
        .map(recovered)
        .filter((n) => s.pools.get(n.pool.toLowerCase())?.indices.has(n.commitment.toLowerCase())),
    ];
    const next = {
      ...this.vault.data,
      notes,
      attempts: reconciled(this.vault.data.attempts, notes, this.deployment, s),
    };
    if (JSON.stringify(next) !== JSON.stringify(this.vault.data)) await this.vault.save(next);
    this.current = s;
    return s;
  }
  noteState(n: SavedNote): string {
    if (n.deployment !== this.deployment.id) return 'Other deployment';
    if (!this.current) return 'Sync required';
    const p = this.current.pools.get(n.pool.toLowerCase());
    if (p?.spent.get(n.id)) return 'Spent';
    if (
      this.vault.data.attempts.some((a) => isActive(a) && (a.source === n.id || a.output === n.id))
    )
      return 'Reserved';
    return p?.indices.has(n.commitment.toLowerCase()) ? 'Available' : 'Awaiting deposit';
  }
  private async newNote(pool: Hex, output = false): Promise<SavedNote> {
    if (!this.vault.data.recovery?.confirmed || !this.candidates)
      throw new Error('Back up and confirm your recovery phrase before creating notes');
    const note = await deriveNote(
      this.candidates.key,
      this.deployment.id,
      pool,
      nextCounter(this.vault.data.notes, this.deployment.id, pool),
    );
    const valued =
      !output &&
      this.deployment.noteVersion === 2 &&
      pool.toLowerCase() === this.deployment.pool.toLowerCase()
        ? withAmount(note, this.deployment.defaultDepositAmount ?? this.deployment.denomination)
        : note;
    return { ...valued, createdAt: Date.now() };
  }
  private preparedNote(note: SavedNote, pool: Hex, output = false): SavedNote {
    validateSecretNote(note);
    const d = this.deployment;
    if (note.deployment !== d.id || note.pool.toLowerCase() !== pool.toLowerCase())
      throw new Error('Prepared note belongs to a different pool');
    if (
      this.vault.data.notes.some((n) => n.id === note.id || n.nullifierHash === note.nullifierHash)
    )
      throw new Error('This output note was already used. Generate and save a fresh note.');
    if (
      !output &&
      d.noteVersion === 2 &&
      pool.toLowerCase() === d.pool.toLowerCase() &&
      note.amount !== (d.defaultDepositAmount ?? d.denomination)
    )
      throw new Error('Wrong input note amount');
    if (output && note.amount !== undefined)
      throw new Error('Output note must not assume the received amount');
    return note;
  }
  async deposit(wallet: Wallet, account: Hex, prepared?: SavedNote) {
    return this.exclusive(async () => {
      await this.sync();
      await this.requireReady('deposit');
      if (
        BigInt((await wallet.request({ method: 'eth_chainId' })) as string) !==
        BigInt(this.deployment.chainId)
      )
        throw new Error('Switch your wallet to local chain 9');
      const accounts = (await wallet.request({ method: 'eth_accounts' })) as string[];
      if (!accounts.some((a) => a.toLowerCase() === account.toLowerCase()))
        throw new Error('Wallet account changed; reconnect');
      const note = prepared
          ? this.preparedNote(prepared, this.deployment.pool)
          : await this.newNote(this.deployment.pool),
        attempt: Attempt = {
          id: crypto.randomUUID(),
          deployment: this.deployment.id,
          kind: 'deposit',
          source: note.id,
          sender: account,
          state: 'broadcasting',
          createdAt: Date.now(),
        };
      await this.vault.save({
        ...this.vault.data,
        notes: [...this.vault.data.notes, note],
        attempts: [...this.vault.data.attempts, attempt],
      });
      let result: Attempt;
      try {
        const hash = (await wallet.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: account,
              to: note.pool,
              value: `0x${BigInt(this.deployment.defaultDepositAmount ?? this.deployment.denomination).toString(16)}`,
              data: encodeFunctionData({
                abi: poolAbi,
                functionName: 'depositETH',
                args: [note.baseCommitment ?? note.commitment],
              }),
            },
          ],
        })) as Hex;
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid wallet hash');
        result = { ...attempt, hash, state: 'submitted' };
      } catch {
        result = {
          ...attempt,
          state: 'unknown',
          detail: 'Wallet result uncertain. Refresh to look for the saved commitment.',
        };
      }
      await this.replaceAttempt(result);
      return result;
    });
  }
  async localTestWallet(): Promise<{ wallet: Wallet; account: Hex }> {
    return this.exclusive(async () => {
      const d = this.deployment;
      if (
        d.chainId !== '9' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(d.rpcUrl).hostname)
      )
        throw new Error('This wallet is available only on the configured Himitsu network.');
      await this.sync();
      if (!this.vault.data.testWalletKey)
        await this.vault.save({ ...this.vault.data, testWalletKey: generatePrivateKey() });
      const account = privateKeyToAccount(this.vault.data.testWalletKey!);
      const chain = defineChain({
        id: 9,
        name: 'Himitsu local',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [d.rpcUrl] } },
      });
      const client = createWalletClient({ account, chain, transport: http(d.rpcUrl) });
      const wallet: Wallet = {
        request: async ({ method, params }) => {
          if (method === 'eth_chainId') return this.rpc.request<Hex>('eth_chainId');
          if (method === 'eth_accounts' || method === 'eth_requestAccounts')
            return [account.address];
          if (method === 'eth_sendTransaction') {
            const tx = params?.[0] as { from: Hex; to: Hex; data: Hex; value: Hex };
            if (
              tx.from.toLowerCase() !== account.address.toLowerCase() ||
              tx.to.toLowerCase() !== d.pool.toLowerCase()
            )
              throw new Error('This wallet can only sign deposits to this pool');
            return client.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
          }
          throw new Error('Unsupported wallet operation');
        },
      };
      return { wallet, account: account.address };
    });
  }
  private async replaceAttempt(attempt: Attempt) {
    await this.vault.save({
      ...this.vault.data,
      attempts: this.vault.data.attempts.map((a) => (a.id === attempt.id ? attempt : a)),
    });
  }
  async spend(
    id: string,
    kind: 'swap' | 'withdraw',
    recipient: string,
    onProgress: (text: string) => void,
    swapQuote?: { expected: string; minimum: string; quotedAt: number },
    preparedOutput?: SavedNote,
  ) {
    return this.exclusive(async () => {
      onProgress('Checking canonical notes and pool nonce…');
      await this.sync();
      const d = this.deployment,
        note = this.vault.data.notes.find((n) => n.id === id);
      if (!note || this.noteState(note) !== 'Available')
        throw new Error('Select an available note after synchronization');
      const reverse = note.pool.toLowerCase() === d.outputPool.toLowerCase();
      if (!reverse && note.pool.toLowerCase() !== d.pool.toLowerCase())
        throw new Error('Unknown source pool');
      const destinationPool = reverse ? d.pool : d.outputPool;
      if (kind === 'withdraw' && (!isAddress(recipient) || BigInt(recipient) === 0n))
        throw new Error('Enter a nonzero recipient address');
      if (
        this.vault.data.attempts.some(
          (a) =>
            a.deployment === d.id &&
            a.sender.toLowerCase() === note.pool.toLowerCase() &&
            isActive(a),
        )
      )
        throw new Error('This pool has an unresolved local transaction. Reconcile it first.');
      await this.requireReady(
        kind === 'swap' ? 'swap' : 'withdrawal',
        note.pool,
        note.amount ?? d.denomination,
      );
      const expected = swapQuote ? BigInt(swapQuote.expected) : BigInt(this.health!.quote);
      const minimum = swapQuote ? BigInt(swapQuote.minimum) : minimumOutput(expected, 50);
      if (kind === 'swap' && d.noteVersion === 2) {
        if (expected <= 0n || minimum <= 0n || minimum > expected)
          throw new Error('Invalid swap quote');
        if (
          swapQuote &&
          (Date.now() - swapQuote.quotedAt > 30000 || swapQuote.quotedAt > Date.now())
        )
          throw new Error('Quote expired. Review the refreshed quote and try again.');
        if (BigInt(this.health!.quote) < minimum)
          throw new Error('Price moved beyond your slippage limit. Review a new quote.');
      }
      const nonce = await this.freeNonce(note.pool);
      if (await contractRead(this.rpc, note.pool, 'spent', [note.nullifierHash]))
        throw new Error('This note was just spent; refresh');
      const latest = await this.rpc.request<Block>('eth_getBlockByNumber', ['latest', false]),
        deadline = BigInt(latest.timestamp) + 300n;
      const output =
        kind === 'swap'
          ? preparedOutput
            ? this.preparedNote(preparedOutput, destinationPool, true)
            : await this.newNote(destinationPool, true)
          : undefined;
      if (output)
        await this.vault.save({ ...this.vault.data, notes: [...this.vault.data.notes, output] });
      const target = kind === 'swap' ? d.pair : (recipient as Hex);
      const pool = this.current!.pools.get(note.pool.toLowerCase())!,
        root = hex32(pool.tree.root());
      const execute =
        kind === 'swap'
          ? d.noteVersion === 2
            ? encodeFunctionData({
                abi: poolV2Abi,
                functionName: 'spendAndSwapQuoted',
                args: [d.pair, minimum, destinationPool, output!.commitment],
              })
            : encodeFunctionData({
                abi: poolAbi,
                functionName: 'spendAndSwapToNote',
                args: [
                  d.pair,
                  d.wethIsToken0 ? 0n : BigInt(d.outputDenomination),
                  d.wethIsToken0 ? BigInt(d.outputDenomination) : 0n,
                  d.outputPool,
                  output!.commitment,
                ],
              })
          : encodeFunctionData({ abi: poolAbi, functionName: 'spend' });
      const fee = fundingRequired(BigInt(latest.baseFeePerGas), kind === 'swap').fee;
      if (fee > 10_000_000_000n) throw new Error('Network fee exceeds sponsor policy');
      const tx: FrameTransaction = {
        chainId: BigInt(d.chainId),
        nonce,
        sender: note.pool,
        fees: { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: fee, maxFeePerBlobGas: 0n },
        blobVersionedHashes: [],
        signatures: [{ scheme: 0, signer: '0x', msg: '0x', signature: '0x' }],
        frames: [
          {
            mode: 1,
            flags: 0,
            target: '0x0000000000000000000000000000000000008141',
            limits: { execution: 5000n, state: 0n },
            value: 0n,
            data: `0x${deadline.toString(16).padStart(16, '0')}`,
          },
          {
            mode: 1,
            flags: 2,
            target: null,
            limits: { execution: 500000n, state: 0n },
            value: 0n,
            data: encodeFunctionData({
              abi: d.noteVersion === 2 ? poolV2Abi : poolAbi,
              functionName: 'validateSpend',
              args:
                d.noteVersion === 2
                  ? [root, note.nullifierHash, target, BigInt(note.amount!)]
                  : [root, note.nullifierHash, target],
            }),
          },
          {
            mode: 1,
            flags: 1,
            target: d.sponsor,
            limits: { execution: 50000n, state: 0n },
            value: 0n,
            data: '0x48494d49',
          },
          {
            mode: 2,
            flags: 0,
            target: note.pool,
            limits: {
              execution: kind === 'swap' ? 900000n : 200000n,
              state: kind === 'swap' ? 1500000n : 300000n,
            },
            value: 0n,
            data: execute,
          },
        ],
      };
      const [hi, lo] = digestLimbs(signingHash(tx));
      const index = pool.indices.get(note.commitment.toLowerCase())!;
      onProgress('Generating the proof locally in your browser…');
      const proof = await this.prove(d, {
        root: BigInt(root).toString(),
        nullifierHash: BigInt(note.nullifierHash).toString(),
        recipient: BigInt(target).toString(),
        txHashHi: hi.toString(),
        txHashLo: lo.toString(),
        nullifier: note.nullifier,
        secret: note.secret,
        ...(d.noteVersion === 2 ? { amount: note.amount } : {}),
        ...pool.tree.path(index),
      });
      tx.signatures[0]!.signature = proof;
      onProgress('Rechecking nonce and saving the transaction before broadcast…');
      if ((await this.freeNonce(note.pool)) !== nonce)
        throw new Error(
          'Another user consumed the pool nonce while proving. Refresh and explicitly retry.',
        );
      const head = await this.rpc.request<Block>('eth_getBlockByNumber', ['latest', false]);
      if (BigInt(head.timestamp) + 10n >= deadline)
        throw new Error('Proof deadline is too close; explicitly retry');
      const raw = serializeTransaction(tx),
        hash = keccak256(raw);
      const attempt: Attempt = {
        id: crypto.randomUUID(),
        deployment: d.id,
        kind,
        source: id,
        ...(output ? { output: output.id } : {}),
        sender: note.pool,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        raw,
        hash,
        ...(kind === 'swap' && d.noteVersion === 2
          ? { quote: { expected: expected.toString(), minimum: minimum.toString() } }
          : {}),
        maxFeePerGas: tx.fees.maxFeePerGas.toString(),
        frameDetails: tx.frames.map((f, i) => ({
          mode: f.mode === 1 ? 'VERIFY' : 'SENDER',
          purpose: [
            'Check expiry',
            'Verify note ownership and authorize this action',
            'Approve gas payment onchain',
            kind === 'swap' ? 'Swap and create output note atomically' : 'Withdraw the note',
          ][i]!,
          target: f.target ?? tx.sender,
          executionGas: f.limits.execution.toString(),
          stateGas: f.limits.state.toString(),
        })),
        state: 'broadcasting',
        createdAt: Date.now(),
      };
      await this.vault.save({
        ...this.vault.data,
        attempts: [...this.vault.data.attempts, attempt],
      });
      let result: Attempt;
      try {
        const submitted = await this.rpc.request<Hex>('eth_sendRawTransaction', [raw]);
        if (submitted.toLowerCase() !== hash.toLowerCase()) throw new Error('Hash mismatch');
        result = { ...attempt, state: 'submitted' };
      } catch {
        result = {
          ...attempt,
          state: 'unknown',
          detail:
            'Submission result uncertain. Refresh; the saved transaction must be reconciled before retrying.',
        };
      }
      await this.replaceAttempt(result);
      return result;
    });
  }
  private async freeNonce(pool: Hex) {
    const [latest, pending] = await Promise.all(
      ['latest', 'pending'].map((tag) =>
        this.rpc.request<Hex>('eth_getTransactionCount', [pool, tag]),
      ),
    );
    if (BigInt(latest!) !== BigInt(pending!))
      throw new Error('Another pool transaction is pending. Wait and refresh before proving.');
    return BigInt(latest!);
  }
}
const assets = new Map<string, Promise<Uint8Array>>();
async function artifact(a: { url: string; sha256: string }) {
  let pending = assets.get(a.sha256);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(a.url);
      if (!response.ok) throw new Error('Proving artifact unavailable; run bun run deploy:app');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join('');
      if (hash !== a.sha256) throw new Error('Proving artifact hash mismatch');
      return bytes;
    })();
    assets.set(a.sha256, pending);
  }
  try {
    return await pending;
  } catch (e) {
    assets.delete(a.sha256);
    throw e;
  }
}
async function browserProof(d: Deployment, input: unknown): Promise<Hex> {
  const [wasm, zkey] = await Promise.all([artifact(d.artifacts.wasm), artifact(d.artifacts.zkey)]);
  return new Promise((resolve, reject) => {
    const worker = new Worker('/prover.worker.js');
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Proof generation timed out; nothing was submitted'));
    }, 180000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      finish();
      if (e.data.error) reject(new Error(e.data.error));
      else if (!/^0x[0-9a-f]{512}$/.test(e.data.proof)) reject(new Error('Malformed proof'));
      else resolve(e.data.proof);
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Browser prover failed; nothing was submitted'));
    };
    worker.postMessage({ wasm, zkey, input });
  });
}
export { Vault, IndexedVaultStore };
