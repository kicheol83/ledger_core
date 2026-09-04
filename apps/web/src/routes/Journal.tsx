import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Empty, Failure, Loading } from '../components/state.js';
import { ApiError, get, post } from '../lib/api.js';
import { formatAmount, formatTimestamp, shortId, sumMinorUnits } from '../lib/money.js';
import type { HistoryEntry, Transaction } from '../lib/types.js';
import { useAsync } from '../lib/useAsync.js';
import './Journal.css';

const PAGE_SIZE = 25;

export function Journal(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('accountId') ?? '';

  const [draft, setDraft] = useState(accountId);

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<HistoryEntry[][]>([]);

  const history = useAsync(async () => {
    if (!accountId) {
      return { transactions: [], nextCursor: null };
    }

    const query = new URLSearchParams({ accountId, limit: String(PAGE_SIZE) });
    if (cursor) {
      query.set('beforeEntryId', cursor);
    }

    const page = await get<{ transactions: HistoryEntry[]; nextCursor: string | null }>(
      `/transactions?${query.toString()}`,
    );

    setPages((existing) => (cursor ? [...existing, page.transactions] : [page.transactions]));

    return page;
  }, [accountId, cursor]);

  const rows = pages.flat();

  const show = useCallback(
    (next: string) => {
      setCursor(undefined);
      setPages([]);
      setParams(next ? { accountId: next } : {});
    },
    [setParams],
  );

  return (
    <div className="stack">
      <header className="stack">
        <h1>Journal</h1>
        <p className="caption">
          Every movement on one account, newest first. Amounts sit on the side they moved: out on
          the left, in on the right.
        </p>
      </header>

      <section className="card picker picker--single">
        <div className="picker__field">
          <label className="label" htmlFor="accountId">
            Account id
          </label>
          <div className="picker__row">
            <input
              id="accountId"
              className="input figure"
              value={draft}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="button" className="button" onClick={() => show(draft.trim())}>
              Show journal
            </button>
          </div>
        </div>
      </section>

      {!accountId ? (
        <Empty title="Enter an account id to read its journal." />
      ) : history.error ? (
        <Failure
          message={history.error.message}
          code={history.error.code}
          traceId={history.error.traceId}
          onRetry={history.reload}
        />
      ) : history.loading && rows.length === 0 ? (
        <Loading label="Reading the journal…" />
      ) : rows.length === 0 ? (
        <Empty title="Nothing has moved on this account yet." />
      ) : (
        <>
          <Ledger rows={rows} accountId={accountId} onChanged={() => show(accountId)} />

          {history.data?.nextCursor ? (
            <button
              type="button"
              className="button button--quiet journal__more"
              disabled={history.refreshing}
              onClick={() => setCursor(history.data?.nextCursor ?? undefined)}
            >
              {history.refreshing ? 'Reading…' : 'Earlier entries'}
            </button>
          ) : (
            <p className="caption journal__end">That is the whole journal for this account.</p>
          )}
        </>
      )}
    </div>
  );
}

function Ledger({
  rows,
  accountId,
  onChanged,
}: {
  rows: HistoryEntry[];
  accountId: string;
  onChanged: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  return (
    <div className="ledger">
      <div className="ledger__rule" aria-hidden="true" />

      <header className="ledger__head">
        <span className="label">Out</span>
        <span className="label ledger__head-meta">Entry</span>
        <span className="label">In</span>
      </header>

      <ol className="ledger__rows">
        {rows.map((row) => (
          <li key={`${row.id}-${row.direction}`}>
            <Row
              row={row}
              accountId={accountId}
              expanded={expanded === row.id}
              onToggle={() => setExpanded(expanded === row.id ? undefined : row.id)}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Row({
  row,
  accountId,
  expanded,
  onToggle,
  onChanged,
}: {
  row: HistoryEntry;
  accountId: string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}): JSX.Element {
  const outgoing = row.direction === 'DEBIT';
  const reference =
    typeof row.metadata['reference'] === 'string' ? row.metadata['reference'] : undefined;
  const reason = typeof row.metadata['reason'] === 'string' ? row.metadata['reason'] : undefined;

  return (
    <article className={expanded ? 'row row--open' : 'row'}>
      <button type="button" className="row__summary" onClick={onToggle} aria-expanded={expanded}>
        <span className="row__amount row__amount--out figure">
          {outgoing ? formatAmount(row.amount, row.currency) : ''}
        </span>

        <span className="row__meta">
          <span className="row__type">{label(row.type)}</span>
          <span className="row__when caption figure">{formatTimestamp(row.createdAt)}</span>
          {row.status === 'REVERSED' ? <span className="chip chip--reversed">Reversed</span> : null}
          {reference ? <span className="caption">{reference}</span> : null}
          {reason ? <span className="caption">{reason}</span> : null}
        </span>

        <span className="row__amount row__amount--in figure">
          {outgoing ? '' : formatAmount(row.amount, row.currency)}
        </span>
      </button>

      {expanded ? (
        <Detail transactionId={row.id} accountId={accountId} onChanged={onChanged} />
      ) : null}
    </article>
  );
}

function Detail({
  transactionId,
  accountId,
  onChanged,
}: {
  transactionId: string;
  accountId: string;
  onChanged: () => void;
}): JSX.Element {
  const detail = useAsync(
    () => get<Transaction>(`/transactions/${transactionId}`),
    [transactionId],
  );
  const [reversing, setReversing] = useState(false);
  const [reversalError, setReversalError] = useState<string | undefined>(undefined);

  if (detail.loading) {
    return <Loading label="Reading both sides…" />;
  }

  if (detail.error || !detail.data) {
    return <Failure message={detail.error?.message ?? 'Could not read this transaction.'} />;
  }

  const transaction = detail.data;
  const entries = transaction.entries ?? [];

  const signed = entries.map((entry) =>
    entry.direction === 'CREDIT' ? entry.amount : `-${entry.amount}`,
  );

  async function reverse(): Promise<void> {
    setReversing(true);
    setReversalError(undefined);

    try {
      await post(`/transactions/${transactionId}/reversal`, {
        reason: 'Reversed from the operations console',
      });
      onChanged();
    } catch (caught) {
      setReversalError(caught instanceof ApiError ? caught.message : 'Could not reverse it.');
    } finally {
      setReversing(false);
    }
  }

  return (
    <div className="detail">
      <dl className="detail__facts">
        <div>
          <dt className="label">Transaction</dt>
          <dd className="figure">{transaction.id}</dd>
        </div>
        <div>
          <dt className="label">Status</dt>
          <dd>{transaction.status}</dd>
        </div>
        {transaction.reversesId ? (
          <div>
            <dt className="label">Undoes</dt>
            <dd className="figure">{shortId(transaction.reversesId)}</dd>
          </div>
        ) : null}
      </dl>

      <table className="entries">
        <caption className="sr-only">
          Every ledger entry belonging to this transaction, with its account and direction.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="label">
              Account
            </th>
            <th scope="col" className="label entries__out">
              Out
            </th>
            <th scope="col" className="label entries__in">
              In
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className={entry.accountId === accountId ? 'entries__self' : undefined}
            >
              <td className="figure">
                {shortId(entry.accountId)}
                {entry.accountId === accountId ? (
                  <span className="caption"> · this account</span>
                ) : null}
              </td>
              <td className="figure entries__out">
                {entry.direction === 'DEBIT'
                  ? formatAmount(entry.amount, transaction.currency)
                  : ''}
              </td>
              <td className="figure entries__in">
                {entry.direction === 'CREDIT'
                  ? formatAmount(entry.amount, transaction.currency)
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="label">
              Sum
            </th>
            <td colSpan={2} className="figure entries__sum">
              {formatAmount(sumMinorUnits(signed), transaction.currency)} {transaction.currency}
            </td>
          </tr>
        </tfoot>
      </table>

      {transaction.status === 'COMPLETED' && transaction.type !== 'REVERSAL' ? (
        <div className="detail__actions">
          <button
            type="button"
            className="button button--quiet"
            disabled={reversing}
            onClick={() => void reverse()}
          >
            {reversing ? 'Reversing…' : 'Reverse this transaction'}
          </button>
          <p className="caption">
            Writes the mirror image as a new transaction. Nothing here is edited or removed.
          </p>
          {reversalError ? (
            <p className="caption picker__error" role="alert">
              {reversalError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function label(type: HistoryEntry['type']): string {
  switch (type) {
    case 'TRANSFER':
      return 'Transfer';
    case 'DEPOSIT':
      return 'Deposit';
    case 'WITHDRAWAL':
      return 'Withdrawal';
    case 'REVERSAL':
      return 'Reversal';
  }
}
