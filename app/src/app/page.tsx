import { SiteNav } from '../components/site-nav';
import Link from 'next/link';
import styles from './home.module.css';

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
      <path d="m13 2 6 28" stroke="var(--home-bg)" strokeWidth="2" />
    </svg>
  );
}
function Eth() {
  return (
    <svg width="24" height="38" viewBox="0 0 24 38" fill="none" aria-hidden="true">
      <path d="m12 0 12 20-12 7L0 20 12 0Z" fill="currentColor" />
      <path d="m0 23 12 7 12-7-12 15L0 23Z" fill="currentColor" />
      <path d="m12 0 12 20-12-5V0Z" fill="#999" />
    </svg>
  );
}
const faqs = [
  [
    'What is Himitsu?',
    'Himitsu lets you trade tokens without revealing which deposit you spent. Save a private note file when you deposit, then use it to swap through Uniswap or withdraw your funds.',
  ],
  [
    'What is the saved file?',
    'It is called a private note. This secret file gives access to your deposited funds. Save it before depositing, and save the new file before each swap. Anyone who gets the file can spend those funds. A connected wallet cannot restore a lost file.',
  ],
  [
    'Who sends my swap and pays the network fee?',
    'Your browser checks that you own the funds and sends the transaction directly to the network. The app does not use a service to submit swaps for you. A separate, funded sponsor account pays eligible network fees.',
  ],
  [
    'Can Uniswap take more tokens than I approve?',
    'No. Himitsu sends only the amount you approve to Uniswap. It does not give the exchange permission to take more from your wallet.',
  ],
  [
    'Is everything about my trade private?',
    'No. The system hides which deposit you spend. The amount, time, and swap activity are still public',
  ],
  [
    'Why does Himitsu use EIP-8141?',
    'EIP-8141 lets one transaction run the funds check, fee sponsor, and swap in order. Himitsu uses it instead of ERC-4337, which sends smart account actions through a separate entry contract and submission service. ERC-4337 can also cover fees; EIP-8141 fits the transaction flow we built.',
  ],
];

export default function Home() {
  return (
    <div className={styles.home}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <SiteNav page="home" />
      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <h1 id="hero-title">A more private way to swap</h1>
            <p className={styles.intro}>
              Use a saved file to trade through Uniswap. Amounts and timing stay public.
            </p>
            <div className={styles.actions}>
              <Link className={styles.button} href="/app" prefetch={false}>
                Try Himitsu
              </Link>
              <a className={styles.textLink} href="#how-it-works">
                See how it works
              </a>
            </div>
          </div>
          <div
            className={styles.stage}
            role="img"
            aria-label="Illustration of swapping ETH for hUSD while keeping the deposit private. Not a live quote."
          >
            <div className={styles.stageGrid} />
            <span className={styles.stageLabel}>HIDE WHICH DEPOSIT YOU SPEND</span>
            <div className={styles.noteCard}>
              <div className={styles.previewTop}>
                <span>YOUR SECRET FILE</span>
                <span>↗</span>
              </div>
              <div className={styles.noteGlyph}>秘密</div>
              <div className={styles.noteDots}>•••• •••• •••• ••••</div>
              <div className={styles.noteBottom}>
                <span>Keep it safe</span>
                <span>Controls your funds</span>
              </div>
            </div>
            <div className={styles.swapPreview}>
              <div className={styles.previewTop}>
                <span className={styles.previewBrand}>
                  <Mark />
                  himitsu
                </span>
                <span className={styles.previewPill}>Token swap</span>
              </div>
              <div className={styles.previewPair}>
                <div>
                  <span className={styles.coin}>
                    <Eth />
                  </span>
                  <span className={styles.tokenName}>ETH</span>
                  <strong>0.1</strong>
                  <small>You send</small>
                </div>
                <span className={styles.pairArrow}>⇄</span>
                <div>
                  <span className={`${styles.coin} ${styles.darkCoin}`}>$</span>
                  <span className={styles.tokenName}>hUSD</span>
                  <strong>•••</strong>
                  <small>You receive</small>
                </div>
              </div>
              <div className={styles.previewRoute}>
                <span>Swap on</span>
                <strong>Uniswap</strong>
              </div>
              <div className={styles.previewSubmit}>
                You approve each swap
              </div>
              <p className={styles.previewFoot}>Only the approved amount · No swap service</p>
            </div>
            <span className={styles.stageCaption}>PRODUCT PREVIEW / NOT A LIVE QUOTE</span>
          </div>
        </section>
        <div className={styles.stack}>
          <span>BUILT ON OPEN PROTOCOLS</span>
          <span>
            Ethereum <small>One transaction · ordered steps</small>
          </span>
          <span>
            Uniswap <small>Shared liquidity</small>
          </span>
        </div>
        <section id="why-himitsu" className={styles.features} aria-labelledby="features-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>SAVED FILES · DIRECT SWAPS</p>
            <h2 id="features-title">
              Hide which deposit you spent.
              <br />
              Swap through Uniswap.
            </h2>
            <p>
              Himitsu lets you use a saved private note file to swap through Uniswap. The network
              checks that the file can spend the funds, while a separate funded account can pay
              some network fees.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ↗
              </span>
              <h3>Your browser sends the swap.</h3>
              <p>
                Your browser sends the transaction straight to the network. A built-in fee sponsor
                checks whether it will cover the network cost. No swap service submits it for you.
              </p>
              <span className={styles.featureTag}>DIRECT SUBMISSION · SEPARATE FEE SPONSOR</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ⊘
              </span>
              <h3>Only the amount you approve.</h3>
              <p>
                Himitsu sends the amount you approve to Uniswap. The exchange cannot pull extra
                tokens from your wallet.
              </p>
              <span className={styles.featureTag}>WETH → UNISWAP → hUSD</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ∗
              </span>
              <h3>Save the file for your new tokens.</h3>
              <p>
                The network checks that your file can spend the funds without showing which deposit
                is yours. Save the new file to access the tokens you receive.
              </p>
              <span className={styles.featureTag}>YOUR FILE CONTROLS YOUR FUNDS</span>
            </article>
          </div>
        </section>
        <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
          <div className={styles.howHeading}>
            <p className={styles.eyebrow}>FROM ETH DEPOSIT TO SAVED WETH BALANCE</p>
            <h2 id="how-title">
              Save your file.
              <br />
              Use it when ready.
            </h2>
            <Link className={styles.textLink} href="/app" prefetch={false}>
              Open the app
            </Link>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Deposit ETH and save your file</h3>
                <p>
                  Connect your wallet and deposit 0.1 ETH. Download the secret file before you
                  approve the deposit. It is the only way to access those funds.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Swap using your saved file</h3>
                <p>
                  Add your file, review the current price and minimum you may receive, then save a
                  new file for your hUSD. Himitsu swaps through Uniswap and puts the tokens you
                  receive into your new balance.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Withdraw when you’re ready</h3>
                <p>
                  Add your latest file and send the balance to an address you choose. There is no
                  account that can restore a lost file, so keep it somewhere safe.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section id="faq" className={styles.faq} aria-labelledby="faq-title">
          <div className={styles.faqHeading}>
            <p className={styles.eyebrow}>A FEW THINGS TO KNOW.</p>
            <h2 id="faq-title">Good questions.</h2>
          </div>
          <div className={styles.faqList}>
            {faqs.map(([question, answer], i) => (
              <details key={question}>
                <summary>
                  <span className={styles.faqNumber}>0{i + 1}</span>
                  <span>{question}</span>
                  <span className={styles.plus} aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.closing} aria-labelledby="closing-title">
          <div>
            <p className={styles.eyebrow}>SWAP THROUGH UNISWAP · HIDE WHICH DEPOSIT YOU SPEND</p>
            <h2 id="closing-title">Trade with more privacy.</h2>
            <Link className={styles.button} href="/app" prefetch={false}>
              Launch Himitsu
            </Link>
          </div>
          <span className={styles.closingGlyph} aria-hidden="true">
            秘密
          </span>
        </section>
      </main>
    </div>
  );
}
