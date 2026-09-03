import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, Failure, Loading } from '../components/state.js';
import { ApiError, get, post } from '../lib/api.js';
import { formatAmount, isNegative, isZero, shortId } from '../lib/money.js';
import type { Account, Balance, Reconciliation } from '../lib/types.js';
import { useAsync } from '../lib/useAsync.js';
import './Accounts.css';

const CURRENCIES = ['UZS', 'KRW', 'USD', 'EUR', 'JPY'];

export function Accounts(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? '';

  const accounts = useAsync(
    () =>
      userId
        ? get<{ accounts: Account[] }>(`/accounts?userId=${userId}`)
        : Promise.resolve({ accounts: [] }),
    [userId],
  );

  const balances = useAsync(
    () =>
      userId
        ? get<{ balances: Balance[] }>(`/balances?userId=${userId}`)
        : Promise.resolve({ balances: [] }),
    [userId],
  );

  const reload = useCallback(() => {
    accounts.reload();
    balances.reload();
  }, [accounts, balances]);

  return (
    <div className="stack">
      <header className="stack">
        <h1>Accounts</h1>
        <p className="caption">
          No balance is stored. Each figure below is the sum of that account&apos;s entries,
          computed when this page loaded.
        </p>
      </header>

      <Reconciliations />

      <UserPicker userId={userId} onChange={(next) => setParams(next ? { userId: next } : {})} />

      {userId ? (
        <>
          <OpenAccount userId={userId} onOpened={reload} />

          {accounts.error ? (
            <Failure
              message={accounts.error.message}
              code={accounts.error.code}
              traceId={accounts.error.traceId}
              onRetry={reload}
            />
          ) : accounts.loading ? (
            <Loading label="Reading accounts…" />
          ) : accounts.data && accounts.data.accounts.length > 0 ? (
            <ul className="accounts">
              {accounts.data.accounts.map((account) => (
                <li key={account.id}>
                  <AccountCard
                    account={account}
                    balance={balances.data?.balances.find((b) => b.accountId === account.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="This person has no accounts yet. Open one above to start." />
          )}
        </>
      ) : (
        <Empty title="Enter a person's id to see their accounts, or create one." />
      )}
    </div>
  );
}

function Reconciliations(): JSX.Element {
  const state = useAsync(
    () =>
      Promise.all(
        CURRENCIES.map((currency) =>
          get<Reconciliation>(`/ledger/reconciliation?currency=${currency}`),
        ),
      ),
    [],
  );

  if (!state.data) {
    return (
      <div className="reconciliation reconciliation--pending caption">Checking the ledger…</div>
    );
  }

  const broken = state.data.filter((entry) => !entry.balanced);

  return (
    <div className={broken.length > 0 ? 'reconciliation reconciliation--broken' : 'reconciliation'}>
      <span className="label">Ledger check</span>
      {broken.length === 0 ? (
        <p>
          Every currency sums to zero across all accounts. Value has been neither created nor
          destroyed.
        </p>
      ) : (
        <p role="alert">
          {broken.map((entry) => `${entry.currency} is out by ${entry.imbalance}`).join('; ')}. Stop
          and investigate before trusting any figure on this page.
        </p>
      )}
    </div>
  );
}

function UserPicker({
  userId,
  onChange,
}: {
  userId: string;
  onChange: (userId: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(userId);
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function createPerson(): Promise<void> {
    setCreating(true);
    setError(undefined);

    try {
      const created = await post<{ id: string }>('/users', { email });
      setEmail('');
      setDraft(created.id);
      onChange(created.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the person.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="card picker">
      <div className="picker__field">
        <label className="label" htmlFor="userId">
          Person id
        </label>
        <div className="picker__row">
          <input
            id="userId"
            className="input figure"
            value={draft}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="button" className="button" onClick={() => onChange(draft.trim())}>
            Show accounts
          </button>
        </div>
      </div>

      <div className="picker__divider" aria-hidden="true" />

      <div className="picker__field">
        <label className="label" htmlFor="email">
          Or add someone new
        </label>
        <div className="picker__row">
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            placeholder="person@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={creating || email.length === 0}
            onClick={() => void createPerson()}
          >
            {creating ? 'Adding…' : 'Add person'}
          </button>
        </div>
        {error ? <p className="caption picker__error">{error}</p> : null}
      </div>
    </section>
  );
}

function OpenAccount({ userId, onOpened }: { userId: string; onOpened: () => void }): JSX.Element {
  const [currency, setCurrency] = useState('UZS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function open(): Promise<void> {
    setBusy(true);
    setError(undefined);

    try {
      await post<Account>('/accounts', { userId, currency });
      onOpened();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not open the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card open-account">
      <label className="label" htmlFor="currency">
        Open an account
      </label>
      <div className="picker__row">
        <select
          id="currency"
          className="input figure"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <button type="button" className="button" disabled={busy} onClick={() => void open()}>
          {busy ? 'Opening…' : 'Open account'}
        </button>
      </div>
      {error ? <p className="caption picker__error">{error}</p> : null}
    </section>
  );
}

function AccountCard({
  account,
  balance,
}: {
  account: Account;
  balance: Balance | undefined;
}): JSX.Element {
  const amount = balance?.amount ?? '0';
  const negative = isNegative(amount);

  return (
    <article className="account card">
      <header className="account__header">
        <span className="figure account__id">{shortId(account.id)}</span>
        <span className={`chip chip--${account.status.toLowerCase()}`}>{account.status}</span>
      </header>

      <p
        className={
          negative ? 'account__amount figure account__amount--negative' : 'account__amount figure'
        }
      >
        {formatAmount(amount, account.currency)}
        <span className="account__currency"> {account.currency}</span>
      </p>

      <footer className="account__derivation">
        {balance ? (
          balance.entryCount === 0 ? (
            <span className="caption">No entries yet</span>
          ) : (
            <span className="caption">
              Summed from {balance.entryCount} {balance.entryCount === 1 ? 'entry' : 'entries'}
              {balance.asOfEntryId ? (
                <>
                  , through entry <span className="figure">{balance.asOfEntryId}</span>
                </>
              ) : null}
            </span>
          )
        ) : (
          <span className="caption">Summing…</span>
        )}

        <Link className="account__link" to={`/journal?accountId=${account.id}`}>
          View entries
        </Link>
      </footer>

      {isZero(amount) && balance && balance.entryCount > 0 ? (
        <p className="caption account__note">
          Balanced to zero — the entries cancel out rather than being absent.
        </p>
      ) : null}
    </article>
  );
}
