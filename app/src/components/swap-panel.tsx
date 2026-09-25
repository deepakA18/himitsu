'use client';

type Props = {
  privateNoteMode?: boolean;
  inputAmount: string;
  outputAmount: string;
  balance: string;
  notes: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
  slippage: string;
  onSlippage: (value: string) => void;
  minimum: string;
  market: boolean;
  locked: boolean;
  busy: boolean;
  rolling: boolean;
  status: string;
  error: string;
  reason: string;
  disabled: boolean;
  onSwap: () => void;
};

export function SwapPanel(p: Props) {
  return (
    <section className="swap-card" aria-labelledby="swap-heading">
      <div className="swap-heading">
        <div>
          <p className="eyebrow">FROM YOUR PRIVATE BALANCE</p>
          <h2 id="swap-heading">A little more private.</h2>
        </div>
        <span className="badge">Swap</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.disabled) p.onSwap();
        }}
      >
        <div className={`swap-stage${p.rolling ? ' is-rolling' : ''}`}>
          <div className="coin-track" aria-hidden="true">
            <div className="coin-carrier coin-from">
              <div className="token-coin eth-coin">
                <svg viewBox="0 0 32 48" fill="none">
                  <path d="M16 2 2 24l14 8 14-8L16 2Z" fill="currentColor" />
                  <path d="m2 27 14 19 14-19-14 8L2 27Z" fill="currentColor" />
                  <path d="M16 2v30l14-8L16 2Z" fill="var(--coin-facet)" />
                </svg>
              </div>
            </div>
            <div className="coin-carrier coin-to">
              <div className="token-coin usd-coin">
                <span>$</span>
              </div>
            </div>
          </div>
          <div className="swap-amount-panel">
            <span className="swap-token-name">WETH</span>
            <label htmlFor="swap-input">You pay</label>
            <input
              id="swap-input"
              type="text"
              inputMode="decimal"
              readOnly
              value={p.inputAmount}
              aria-describedby="swap-input-hint"
            />
            <p id="swap-input-hint" className="hint">
              One private note
            </p>
          </div>
          <span className="swap-bridge" aria-hidden="true">
            →
          </span>
          <div className="swap-amount-panel receive-panel">
            <span className="swap-token-name">gUSD</span>
            <label htmlFor="swap-output">You receive{p.market ? ' ≈' : ''}</label>
            <input
              id="swap-output"
              type="text"
              inputMode="decimal"
              readOnly
              value={p.outputAmount}
              placeholder="—"
              aria-describedby="swap-output-hint"
            />
            <p id="swap-output-hint" className="hint">
              {p.outputAmount ? 'Into your private balance' : 'Waiting for a quote'}
            </p>
          </div>
        </div>
        {!p.privateNoteMode && (
          <>
            <div className="swap-balance">
              <span>Available private balance</span>
              <strong>{p.locked ? 'Unlock to view' : `${p.balance} WETH`}</strong>
            </div>
            <label htmlFor="swap-note">Spend from</label>
            <select
              id="swap-note"
              value={p.selected}
              onChange={(e) => p.onSelect(e.target.value)}
              disabled={p.locked || p.busy || !p.notes.length}
            >
              <option value="">
                {p.locked
                  ? 'Unlock your private wallet'
                  : p.notes.length
                    ? 'Choose a private note'
                    : 'No available WETH notes'}
              </option>
              {p.notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="swap-settings">
          <div>
            <label htmlFor="slippage">Slippage tolerance</label>
            <select
              id="slippage"
              value={p.slippage}
              onChange={(e) => p.onSlippage(e.target.value)}
              disabled={p.busy || !p.market}
            >
              <option value="10">0.1%</option>
              <option value="50">0.5%</option>
              <option value="100">1%</option>
            </select>
          </div>
          <div className="swap-minimum">
            <span className="hint">Minimum received</span>
            <strong>{p.minimum ? `${p.minimum} gUSD` : '—'}</strong>
          </div>
        </div>
        <button className="swap-submit" type="submit" disabled={p.disabled} aria-busy={p.rolling}>
          {p.rolling ? 'Swapping…' : 'Swap to private gUSD'}
          <span aria-hidden="true"> ↗</span>
        </button>
        <p className="swap-feedback" role="status" aria-live="polite">
          {p.status || p.reason || 'Ready when you are.'}
        </p>
        {p.error && <p className="error">{p.error}</p>}
        <div className="swap-benefits">
          <span>No exchange allowance</span>
          <span>Gas paid by paymaster</span>
        </div>
        <p className="hint swap-disclosure">
          {p.market
            ? 'Full output returns as a private note. Swap amounts are public.'
            : 'Legacy fixed-output pool. Select Market swaps v2 for full output.'}{' '}
          ETH deposits are wrapped into WETH.
        </p>
      </form>
    </section>
  );
}
