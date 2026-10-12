import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ApiError, newIdempotencyKey, postWithMeta } from '../lib/api';
import { AmountError, formatAmount, formatMoney, shortId, toMinorUnits } from '../lib/money';
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
  const { t } = useI18n();
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
      setAmountError(
        error instanceof AmountError
          ? t.amountError(error.code, currency, error.exponent)
          : t.checkAmount,
      );
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
        <h1>{t.navTransfer}</h1>
        <p className="caption">{t.transferIntro}</p>
      </header>

      <div className="segmented" role="tablist" aria-label={t.operationAria}>
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
            {option === 'transfer'
              ? t.opTransfer
              : option === 'deposit'
                ? t.opDeposit
                : t.opWithdraw}
          </button>
        ))}
      </div>

      <section className="card form">
        {operation === 'transfer' ? (
          <>
            <Field label={t.fromAccount} id="from">
              <input
                id="from"
                className="input figure"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t.toAccount} id="to">
              <input
                id="to"
                className="input figure"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label={t.account} id="account">
            <input
              id="account"
              className="input figure"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </Field>
        )}

        <div className="form__row">
          <Field label={t.amount} id="amount" error={amountError}>
            <input
              id="amount"
              className="input figure"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label={t.currency} id="currency">
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
          <Field label={t.idempotencyKey} id="key">
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
                {t.newKey}
              </button>
            </div>
          </Field>
          <p className="caption">{t.keyHelp}</p>
        </div>

        <div className="form__row form__submit">
          <Field label={t.copies} id="copies">
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
            {busy ? t.sending : copies === 1 ? t.send : t.sendCopies(copies)}
          </button>
        </div>
      </section>

      {attempts.length > 0 ? (
        <section className="stack">
          <h2>{t.whatHappened}</h2>

          <p className="outcome-summary">
            {t.movedTimes(applied)}
            {replayed > 0 ? t.replayedCopies(replayed) : ''}.
          </p>

          <ol className="attempts">
            {attempts.map((attempt) => (
              <li key={attempt.ordinal} className={`attempt attempt--${attempt.outcome}`}>
                <span className="attempt__ordinal figure">#{attempt.ordinal}</span>
                <span className="attempt__outcome">{t.outcome[attempt.outcome]}</span>
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
  const { t } = useI18n();

  return (
    <figure className="taccount">
      <figcaption className="label">{t.entriesWritten}</figcaption>

      <div className="taccount__body">
        <div className="taccount__side taccount__side--debit">
          <span className="label">{t.debit}</span>
          <span className="taccount__amount figure">{formatAmount(amount, currency)}</span>
        </div>

        <div className="taccount__rule" aria-hidden="true" />

        <div className="taccount__side taccount__side--credit">
          <span className="label">{t.credit}</span>
          <span className="taccount__amount figure">{formatAmount(amount, currency)}</span>
        </div>
      </div>

      <p className="taccount__sum caption">
        {t.debitsMinusCredits} <span className="figure">{formatMoney('0', currency)}</span>{' '}
        {t.balancesNote}
      </p>
    </figure>
  );
}
