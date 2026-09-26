'use client';
import { SiteNav } from '../../components/site-nav';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatEther } from 'viem';
import type { Deployment } from '../../../../packages/client/src/chain';
import {
  decodeLog,
  blockTimestamp,
  frameLabel,
  frameStatus,
  loadExplorer,
  parseSearch,
  quantity,
  short,
} from '../../lib/explorer';
import styles from './explorer.module.css';
type Result = Awaited<ReturnType<typeof loadExplorer>>;
export default function Explorer() {
  const params = useSearchParams(),
    router = useRouter();
  const tx = params.get('tx') ?? '',
    block = params.get('block') ?? '',
    before = params.get('before') ?? '',
    pool = params.get('pool') ?? '';
  const [data, setData] = useState<Result | null>(null),
    [deployment, setDeployment] = useState<Deployment | null>(null);
  const [error, setError] = useState(''),
    [searchError, setSearchError] = useState(''),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0);
  const url = (q: Record<string, string> = {}) =>
    `/explorer?${new URLSearchParams({ ...(pool ? { pool } : {}), ...q })}`;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    setDeployment(null);
    async function load() {
      if (pool && !/^0x[0-9a-fA-F]{40}$/.test(pool)) throw new Error('Invalid deployment pool');
      let response = await fetch(
        pool ? `/deployments/${pool.toLowerCase()}.json` : '/deployment.json',
        { cache: 'no-store' },
      );
      if (!response.ok) {
        const catalogResponse = await fetch('/deployments.json', { cache: 'no-store' });
        if (!catalogResponse.ok)
          throw new Error('No deployment manifest is available for the explorer.');
        const catalog = (await catalogResponse.json()) as {
          name: string;
          url: string;
          id?: string;
        }[];
        const selected = pool
          ? catalog.find(
              (entry) =>
                entry.id?.split(':')[0]?.toLowerCase() === pool.toLowerCase() ||
                entry.url.toLowerCase().includes(pool.toLowerCase()),
            ) ?? catalog[0]
          : catalog[0];
        if (!selected?.url) throw new Error('No deployment is listed for the explorer.');
        response = await fetch(selected.url, { cache: 'no-store' });
      }
      if (!response.ok) throw new Error('The deployment manifest could not be loaded.');
      const d = (await response.json()) as Deployment;
      const result = await loadExplorer(d, { tx, block, before });
      if (active) {
        setDeployment(d);
        setData(result);
      }
    }
    load()
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tx, block, before, pool, revision]);
  const receipt = data?.receipt,
    transaction = data?.transaction;
  const address = (value: string) => {
    const labels = deployment
      ? [
          [deployment.pool, 'Input pool'],
          [deployment.outputPool, 'Output pool'],
          [deployment.sponsor, 'Paymaster'],
          [deployment.pair, 'Uniswap V2 pair'],
          [deployment.weth, 'WETH'],
          [deployment.token, 'hUSD'],
        ]
      : [];
    const label = labels.find(([a]) => a.toLowerCase() === value.toLowerCase())?.[1];
    return (
      <span>
        {label && <span className={styles.tag}>{label}</span>}
        <code>{value}</code>
      </span>
    );
  };
  return (
    <div className={styles.shell}>
      <SiteNav page="explorer" />
      <main className={styles.explorer}>
        <div className={styles.toolbar}>
          <Link href={url()}>Latest blocks</Link>
          <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className={styles.title}>
          <p>ONCHAIN, FRAME BY FRAME.</p>
          <h1>Follow the transaction.</h1>
          <p>Public activity on your configured Ethrex node. No wallet connection needed.</p>
        </div>
        <form
          className={styles.search}
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const query = parseSearch(String(new FormData(e.currentTarget).get('query') ?? ''));
              setSearchError('');
              router.push(url(query));
            } catch (e) {
              setSearchError((e as Error).message);
            }
          }}
        >
          <label htmlFor="explorer-query">Transaction hash or block number</label>
          <div>
            <input
              id="explorer-query"
              name="query"
              placeholder="0x… or a block number"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={66}
              aria-describedby={searchError ? 'search-error' : undefined}
            />
            <button>Search</button>
          </div>
          {searchError && (
            <p id="search-error" role="alert">
              {searchError}
            </p>
          )}
        </form>
        {error && (
          <section role="alert">
            <h2>Couldn’t read the node</h2>
            <p>{error}</p>
            <p>
              Check that Ethrex is running and the deployment points to the correct chain. No
              transaction was sent.
            </p>
            <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
          </section>
        )}
        {busy && (
          <section aria-busy="true" role="status">
            <h2>Reading chain data…</h2>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </section>
        )}
        {data && deployment && (
          <>
            <div className={styles.network}>
              <span>
                Chain {deployment.chainId} · {deployment.name ?? 'Ethrex'}
              </span>
              <span>Latest block {quantity(data.head.toString())}</span>
              <span>{deployment.rpcUrl}</span>
            </div>
            {tx ? (
              <>
                {!transaction ? (
                  <section>
                    <h2>Transaction not found</h2>
                    <code>{tx}</code>
                    <p>
                      This node has no transaction with that hash. It may not have accepted it, or
                      you may be viewing a different chain. Refresh to check again.
                    </p>
                  </section>
                ) : (
                  <>
                    {receipt &&
                      data.canonical &&
                      BigInt(receipt.status) === 1n && (
                        <div className={styles.success} role="status">
                          <span className={styles.successMark} aria-hidden="true">✓</span>
                          <span>
                            <strong>Transaction successful</strong>
                            <small>
                              Included in block {quantity(receipt.blockNumber)} ·{' '}
                              {blockTimestamp(data.canonicalBlock?.timestamp)}
                            </small>
                          </span>
                        </div>
                      )}
                    <section>
                      <div className={styles.sectionTitle}>
                        <h2>Transaction</h2>
                        <span className={styles.tag}>
                          {!receipt
                            ? 'Pending / no receipt'
                            : !data.canonical
                              ? 'Non-canonical receipt'
                              : BigInt(receipt.status) === 1n
                                ? 'Succeeded'
                                : 'Failed'}
                        </span>
                      </div>
                      <code className={styles.hash}>{transaction.hash}</code>
                      <dl>
                        <dt>Type</dt>
                        <dd>
                          {BigInt(transaction.type) === 6n
                            ? 'EIP-8141 · Frame transaction (0x06)'
                            : `Ethereum transaction (${transaction.type})`}
                        </dd>
                        <dt>Sender</dt>
                        <dd>{address(transaction.sender ?? transaction.from)}</dd>
                        <dt>Nonce</dt>
                        <dd>{quantity(transaction.nonce)}</dd>
                        <dt>Gas payer</dt>
                        <dd>
                          {receipt?.payer
                            ? address(receipt.payer)
                            : BigInt(transaction.type) === 6n
                              ? 'Not reported'
                              : address(transaction.from)}
                        </dd>
                        <dt>Block</dt>
                        <dd>
                          {receipt ? (
                            <Link href={url({ block: BigInt(receipt.blockNumber).toString() })}>
                              {quantity(receipt.blockNumber)}
                            </Link>
                          ) : (
                            'Awaiting inclusion'
                          )}
                        </dd>
                        <dt>Timestamp</dt>
                        <dd>{blockTimestamp(data.canonicalBlock?.timestamp)}</dd>
                        <dt>Confirmations</dt>
                        <dd>
                          {receipt && data.canonical
                            ? quantity((data.head - BigInt(receipt.blockNumber) + 1n).toString())
                            : '—'}
                        </dd>
                        <dt>Total gas used</dt>
                        <dd>{quantity(receipt?.gasUsed)}</dd>
                        <dt>Transaction fee</dt>
                        <dd>
                          {receipt?.effectiveGasPrice
                            ? `${formatEther(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice))} ETH`
                            : 'Not reported'}
                        </dd>
                        {transaction.to && (
                          <>
                            <dt>To</dt>
                            <dd>{address(transaction.to)}</dd>
                          </>
                        )}
                        {receipt?.contractAddress && (
                          <>
                            <dt>Created contract</dt>
                            <dd>{address(receipt.contractAddress)}</dd>
                          </>
                        )}
                      </dl>
                      {!receipt && (
                        <p>
                          No receipt yet does not establish rejection. Use Refresh to reconcile.
                        </p>
                      )}
                      {receipt && !data.canonical && (
                        <p role="alert">
                          This receipt does not match the canonical block. Refresh before treating
                          its events as settled.
                        </p>
                      )}
                    </section>
                    {!!transaction.frames?.length && (
                      <section>
                        <h2>Inside the frame transaction</h2>
                        <p>
                          Each frame has its own purpose and gas budget. Approval scopes below are
                          allowed permissions, not ERC-20 allowances.
                        </p>
                        <ol className={styles.frames}>
                          {transaction.frames.map((frame, i) => {
                            const result = receipt?.frameReceipts?.[i],
                              mode = Number(BigInt(frame.mode)),
                              scope = Number(BigInt(frame.flags) & 3n);
                            return (
                              <li key={i}>
                                <div className={styles.sectionTitle}>
                                  <h3>
                                    <span className={styles.index}>
                                      {String(i + 1).padStart(2, '0')}
                                    </span>
                                    {frameLabel(
                                      frame,
                                      deployment,
                                      transaction.sender ?? transaction.from,
                                    )}
                                  </h3>
                                  <span className={styles.tag}>
                                    {receipt ? frameStatus(result?.status) : 'Awaiting receipt'}
                                  </span>
                                </div>
                                <dl>
                                  <dt>Mode / scope</dt>
                                  <dd>
                                    {['DEFAULT', 'VERIFY', 'SENDER'][mode] ?? `Unknown (${mode})`} ·{' '}
                                    {
                                      [
                                        'NONE (0x0)',
                                        'PAYMENT (0x1)',
                                        'EXECUTION (0x2)',
                                        'EXECUTION + PAYMENT (0x3)',
                                      ][scope]
                                    }
                                  </dd>
                                  <dt>Target</dt>
                                  <dd>
                                    {address(frame.to ?? transaction.sender ?? transaction.from)}
                                    {!frame.to && <small> Resolved from sender</small>}
                                  </dd>
                                  <dt>Execution gas</dt>
                                  <dd>
                                    {quantity(result?.gasUsed)} used / {quantity(frame.gasLimit)}{' '}
                                    budget
                                  </dd>
                                  <dt>State gas</dt>
                                  <dd>
                                    {quantity(result?.stateGasUsed)} used /{' '}
                                    {quantity(frame.stateGasLimit)} budget
                                  </dd>
                                </dl>
                                <details>
                                  <summary>Frame calldata</summary>
                                  <code>{frame.data}</code>
                                </details>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    )}
                    {receipt && (
                      <section>
                        <h2>
                          Public events <span className={styles.tag}>{receipt.logs.length}</span>
                        </h2>
                        <p>
                          Transfers and commitments are public. A commitment does not reveal a
                          note’s spending secrets.
                        </p>
                        {receipt.logs.length === 0 ? (
                          <p>No events emitted.</p>
                        ) : (
                          receipt.logs.map((log, i) => {
                            const decoded = decodeLog(log, deployment);
                            return (
                              <article className={styles.event} key={i}>
                                <h3>
                                  {i + 1}. {decoded?.title ?? 'Contract event'}
                                </h3>
                                <p>{address(log.address)}</p>
                                {decoded && (
                                  <dl>
                                    {decoded.fields.map(([k, v]) => (
                                      <div className={styles.field} key={k}>
                                        <dt>{k}</dt>
                                        <dd>
                                          <code>{v}</code>
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                <details>
                                  <summary>Raw event</summary>
                                  <pre>{JSON.stringify(log, null, 2)}</pre>
                                </details>
                              </article>
                            );
                          })
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            ) : (
              <section>
                <div className={styles.sectionTitle}>
                  <h2>{block ? `Block ${quantity(block)}` : 'Recent blocks'}</h2>
                  <span>Snapshot · refresh for updates</span>
                </div>
                {data.blocks.map((b) => (
                  <article className={styles.block} key={b.hash}>
                    <div className={styles.sectionTitle}>
                      <Link href={url({ block: BigInt(b.number).toString() })}>
                        Block {quantity(b.number)} ↗
                      </Link>
                      <span>
                        {blockTimestamp(b.timestamp)} ·{' '}
                        {b.transactions.length} transactions
                      </span>
                    </div>
                    {block && <code>{b.hash}</code>}
                    {b.transactions.length ? (
                      <ul className={styles.transactions}>
                        {b.transactions.map((t) => (
                          <li key={t.hash}>
                            <Link href={url({ tx: t.hash })} title={t.hash}>
                              {short(t.hash)} ↗
                            </Link>
                            <span className={styles.tag}>
                              {BigInt(t.type) === 6n
                                ? `${t.frames?.length ?? '?'} frames`
                                : 'Standard'}
                            </span>
                            <span title={t.sender ?? t.from}>{short(t.sender ?? t.from)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.empty}>No transactions in this block.</p>
                    )}
                  </article>
                ))}
                <div className={styles.paging}>
                  {block ? (
                    <>
                      <Link href={url()}>← Latest blocks</Link>
                      {BigInt(block) > 0n && (
                        <Link href={url({ block: (BigInt(block) - 1n).toString() })}>
                          Previous block
                        </Link>
                      )}
                      {BigInt(block) < data.head && (
                        <Link href={url({ block: (BigInt(block) + 1n).toString() })}>
                          Next block
                        </Link>
                      )}
                    </>
                  ) : (
                    <>
                      {before && <Link href={url()}>← Latest blocks</Link>}
                      {data.blocks.length > 0 && BigInt(data.blocks.at(-1)!.number) > 0n && (
                        <Link
                          href={url({
                            before: (BigInt(data.blocks.at(-1)!.number) - 1n).toString(),
                          })}
                        >
                          Older blocks →
                        </Link>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
