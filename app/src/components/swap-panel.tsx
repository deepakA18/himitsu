'use client';

type Props = {
  inputAmount: string;
  outputAmount: string;
  slippage: string;
  onSlippage: (value: string) => void;
  minimum: string;
  market: boolean;
  busy: boolean;
  status: string;
  reason: string;
  disabled: boolean;
  onSwap: () => void;
};

export function SwapPanel(p: Props) {
  return (
    <section className="swap-card" aria-labelledby="swap-heading">
      <div className="swap-heading">
        <div>
          <h2 id="swap-heading">Move WETH privately</h2>
          <p>Uniswap V2 · output saved as a new note</p>
        </div>
      </div>
      <div className="swap-motion-scene" aria-hidden="true">
        <div className="swap-scene-grid" />
        <span className="swap-scene-label">PRIVATE NOTE → PUBLIC LIQUIDITY</span>
        <div className="swap-scene-note swap-scene-input">
          <span>YOUR INPUT NOTE</span>
          <strong>•••• •••• ••••</strong>
          <small>WETH · AMOUNT BOUND</small>
        </div>
        <span className="swap-scene-path" />
        <div className="swap-scene-flight">
          <span>◆</span>
          <span>↗</span>
        </div>
        <div className="swap-scene-note swap-scene-output">
          <span>YOUR NEW NOTE</span>
          <strong>•••• •••• ••••</strong>
          <small>hUSD · SAVED BEFORE SEND</small>
        </div>
        <span className="swap-scene-caption">WETH → UNISWAP V2 → hUSD</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.disabled) p.onSwap();
        }}
      >
        <div className="swap-stage">
          <div className="swap-amount-panel">
            <div className="swap-token-row">
              <label htmlFor="swap-input">You pay</label>
              <span className="swap-token-name">WETH</span>
            </div>
            <input id="swap-input" type="text" inputMode="decimal" readOnly value={p.inputAmount} />
            <p className="hint">From your imported private note</p>
          </div>
          <span className="swap-bridge" aria-hidden="true">↓</span>
          <div className="swap-amount-panel receive-panel">
            <div className="swap-token-row">
              <label htmlFor="swap-output">You receive{p.market ? ' ≈' : ''}</label>
              <span className="swap-token-name">hUSD</span>
            </div>
            <input
              id="swap-output"
              type="text"
              readOnly
              value={p.outputAmount}
              placeholder="Waiting for quote"
            />
            <p className="hint">Into a new private note</p>
          </div>
        </div>
        <div className="swap-settings">
          <label htmlFor="slippage">Slippage</label>
          <select id="slippage" value={p.slippage} onChange={(e) => p.onSlippage(e.target.value)} disabled={p.busy || !p.market}>
            <option value="10">0.1%</option>
            <option value="50">0.5%</option>
            <option value="100">1%</option>
          </select>
          <span className="swap-minimum-label">Minimum received</span>
          <strong className="swap-minimum">{p.minimum ? `${p.minimum} hUSD` : '—'}</strong>
        </div>
        <button className="swap-submit" type="submit" disabled={p.disabled} aria-busy={p.busy}>
          {p.busy ? 'Preparing note…' : 'Create output note'}
        </button>
        <p className="swap-feedback" role="status" aria-live="polite">{p.status || p.reason}</p>
        <p className="swap-disclosure">Exact WETH input · No exchange allowance · Paymaster covers eligible gas</p>
      </form>
    </section>
  );
}
