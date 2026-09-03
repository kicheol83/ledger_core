import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, newIdempotencyKey, postWithMeta } from '../lib/api.js';
import { AmountError, formatAmount, formatMoney, shortId, toMinorUnits } from '../lib/money.js';
import './Transfer.css';

type Operation = 'transfer' | 'deposit' | 'withdraw';

const CURRENCIES = ['UZS', 'KRW', 'USD', 'EUR', 'JPY'];

interface Attempt {
  ordinal: number;
  outcome: 'applied' | 'replayed' | 'refused' | 'failed';
  transactionId?: string | undefined;
  balance?: string | undefined;
  message?: string | undefined;
  code?: string | undefined;
  durationMs: number;
}

interface Result {
  id: string;
  amount: string;
  currency: string;
  balances?: { from: string; to: string };
  balance?: string;
}

export function Transfer(): JSX.Element {
  const [params] = useSearchParams();

  const [operation, setOperation] = useState<Operation>('transfer');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [account, setAccount] = useState(params.get('accountId') ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('UZS');

  const [key, setKey] = useState(() => newIdempotencyKey());
  const [copies, setCopies] = useState(1);

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [entries, setEntries] = useState<{ debit: string; credit: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [amountError, setAmountError] = useState<string | undefined>();

  async function submit(): Promise<void> {
    let minorUnits: string;

    try {
      minorUnits = toMinorUnits(amount, currency);
      setAmountError(undefined);
    } catch (error) {
      setAmountError(error instanceof AmountError ? error.message : 'Check the amount.');
      return;
    }

    const path =
      operation === 'transfer'
        ? '/transfers'
        : operation === 'deposit'
          ? '/deposits'
          : '/withdrawals';

    const body =
      operation === 'transfer'
        ? { fromAccountId: from, toAccountId: to, amount: minorUnits, currency }
        : { accountId: account, amount: minorUnits, currency };

    setBusy(true);
    setAttempts([]);
    setEntries(undefined);

    const collected: Attempt[] = [];

    const started = performance.now();

    const outcomes = await Promise.allSettled(
      Array.from({ length: copies }, () => postWithMeta<Result>(path, body, key)),
    );

    outcomes.forEach((outcome, index) => {
      const durationMs = Math.round(performance.now() - started);

      if (outcome.status === 'fulfilled') {
        const result = outcome.value;

        collected.push({
          ordinal: index + 1,
          outcome: result.replayed ? 'replayed' : 'applied',
          transactionId: result.body.id,
          balance: result.body.balance ?? result.body.balances?.from,
          durationMs,
        });

        if (!result.replayed && operation === 'transfer' && result.body.balances) {
          setEntries({ debit: result.body.amount, credit: result.body.amount });
        } else if (!result.replayed) {
          setEntries({ debit: result.body.amount, credit: result.body.amount });
        }
      } else {
        const error = outcome.reason as ApiError;

        collected.push({
          ordinal: index + 1,

          outcome:
            error.problem?.status >= 500 || error.code === 'NETWORK_ERROR' ? 'failed' : 'refused',
          message: error.message,
          code: error.code,
          durationMs,
        });
      }
    });

    setAttempts(collected);
    setBusy(false);
  }

  const applied = attempts.filter((attempt) => attempt.outcome === 'applied').length;
  const replayed = attempts.filter((attempt) => attempt.outcome === 'replayed').length;

  return (
    <div className="stack">
      <header className="stack">
        <h1>Move money</h1>
        <p className="caption">
          Each of these writes two entries that sum to zero. Send the same request several times
          with one key to see it applied once.
        </p>
      </header>

      <div className="segmented" role="tablist" aria-label="Operation">
        {(['transfer', 'deposit', 'withdraw'] as const).map((option) => (
          <button
            key={option}
            role="tab"
            type="button"
            aria-selected={operation === option}
            className={
              operation === option ? 'segmented__item segmented__item--on' : 'segmented__item'
            }
            onClick={() => setOperation(option)}
          >
            {option === 'transfer' ? 'Transfer' : option === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        ))}
      </div>

      <section className="card form">
        {operation === 'transfer' ? (
          <>
            <Field label="From account" id="from">
              <input
                id="from"
                className="input figure"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To account" id="to">
              <input
                id="to"
                className="input figure"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label="Account" id="account">
            <input
              id="account"
              className="input figure"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </Field>
        )}

        <div className="form__row">
          <Field label="Amount" id="amount" error={amountError}>
            <input
              id="amount"
              className="input figure"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="Currency" id="currency">
            <select
              id="currency"
              className="input figure"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="form__key">
          <Field label="Idempotency key" id="key">
            <div className="picker__row">
              <input
                id="key"
                className="input figure"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setKey(newIdempotencyKey())}
              >
                New key
              </button>
            </div>
          </Field>
          <p className="caption">
            Keep the key and press again: the second request returns the first one&apos;s stored
            answer instead of moving money twice. Change the key and it becomes a new instruction.
          </p>
        </div>

        <div className="form__row form__submit">
          <Field label="Copies to send at once" id="copies">
            <input
              id="copies"
              className="input figure"
              type="number"
              min={1}
              max={10}
              value={copies}
              onChange={(e) => setCopies(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </Field>

          <button type="button" className="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : copies === 1 ? 'Send' : `Send ${copies} copies`}
          </button>
        </div>
      </section>

      {attempts.length > 0 ? (
        <section className="stack">
          <h2>What happened</h2>

          <p className="outcome-summary">
            {applied === 1 ? 'Money moved once' : `Money moved ${applied} times`}
            {replayed > 0
              ? `, and ${replayed} ${replayed === 1 ? 'copy' : 'copies'} got the stored answer back`
              : ''}
            .
          </p>

          <ol className="attempts">
            {attempts.map((attempt) => (
              <li key={attempt.ordinal} className={`attempt attempt--${attempt.outcome}`}>
                <span className="attempt__ordinal figure">#{attempt.ordinal}</span>
                <span className="attempt__outcome">
                  {attempt.outcome === 'applied'
                    ? 'Applied'
                    : attempt.outcome === 'replayed'
                      ? 'Replayed'
                      : attempt.outcome === 'refused'
                        ? 'Refused'
                        : 'Failed'}
                </span>
                <span className="attempt__detail caption">
                  {attempt.transactionId ? (
                    <span className="figure">{shortId(attempt.transactionId)}</span>
                  ) : (
                    attempt.message
                  )}
                </span>
                <span className="attempt__timing caption figure">{attempt.durationMs} ms</span>
              </li>
            ))}
          </ol>

          {entries ? <BalancedEntries amount={entries.debit} currency={currency} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string | undefined;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="caption field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BalancedEntries({ amount, currency }: { amount: string; currency: string }): JSX.Element {
  return (
    <figure className="taccount">
      <figcaption className="label">The entries written</figcaption>

      <div className="taccount__body">
        <div className="taccount__side taccount__side--debit">
          <span className="label">Debit</span>
          <span className="taccount__amount figure">{formatAmount(amount, currency)}</span>
        </div>

        <div className="taccount__rule" aria-hidden="true" />

        <div className="taccount__side taccount__side--credit">
          <span className="label">Credit</span>
          <span className="taccount__amount figure">{formatAmount(amount, currency)}</span>
        </div>
      </div>

      <p className="taccount__sum caption">
        Debits minus credits: <span className="figure">{formatMoney('0', currency)}</span> — the
        transaction balances, which is what the database checked before it committed.
      </p>
    </figure>
  );
}
