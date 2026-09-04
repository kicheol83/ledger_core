import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Failure, Loading } from '../components/state.js';
import { get } from '../lib/api.js';
import { formatRelative, formatTimestamp, shortId } from '../lib/money.js';
import { useAsync, usePolling } from '../lib/useAsync.js';
import './Delivery.css';

type Status = 'PENDING' | 'PUBLISHED' | 'FAILED';

interface OutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  status: Status;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  publishedAt: string | null;
}

interface Stats {
  pending: number;
  published: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
}

const FILTERS: Array<{ value: Status | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Everything' },
  { value: 'PENDING', label: 'Waiting' },
  { value: 'PUBLISHED', label: 'Delivered' },
  { value: 'FAILED', label: 'Given up' },
];

export function Delivery(): JSX.Element {
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [live, setLive] = useState(true);

  const stats = useAsync(() => get<Stats>('/outbox/stats'), []);

  const events = useAsync(
    () =>
      get<{ events: OutboxEvent[]; nextCursor: string | null }>(
        `/outbox/events?limit=25${filter === 'ALL' ? '' : `&status=${filter}`}`,
      ),
    [filter],
  );

  const refresh = useCallback(() => {
    stats.reload();
    events.reload();
  }, [stats, events]);

  usePolling(refresh, 2000, live);

  return (
    <div className="stack">
      <header className="stack">
        <h1>Delivery</h1>
        <p className="caption">
          Every movement of money writes an event in the same transaction as its entries. A separate
          worker takes them from here and sends them out.
        </p>
      </header>

      {stats.data ? <Health stats={stats.data} /> : <Loading label="Reading the queue…" />}

      <div className="delivery__controls">
        <div className="segmented" role="tablist" aria-label="Filter events">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={
                filter === option.value ? 'segmented__item segmented__item--on' : 'segmented__item'
              }
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="delivery__live">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          <span className="label">Refresh every 2s</span>
        </label>
      </div>

      {events.error ? (
        <Failure
          message={events.error.message}
          code={events.error.code}
          traceId={events.error.traceId}
          onRetry={refresh}
        />
      ) : events.loading && !events.data ? (
        <Loading label="Reading events…" />
      ) : events.data && events.data.events.length > 0 ? (
        <EventTable events={events.data.events} />
      ) : (
        <Empty
          title={
            filter === 'FAILED'
              ? 'Nothing has been given up on. Every event has been delivered or is still trying.'
              : 'No events yet. Move some money and they will appear here.'
          }
          action={
            <Link className="button" to="/transfer">
              Move money
            </Link>
          }
        />
      )}
    </div>
  );
}

function Health({ stats }: { stats: Stats }): JSX.Element {
  const stalled = (stats.oldestPendingAgeSeconds ?? 0) > 60;

  return (
    <div className={stalled || stats.failed > 0 ? 'health health--attention' : 'health'}>
      <Metric label="Waiting" value={String(stats.pending)} />
      <Metric label="Delivered" value={String(stats.published)} />
      <Metric
        label="Given up"
        value={String(stats.failed)}
        tone={stats.failed > 0 ? 'fault' : undefined}
      />
      <Metric
        label="Oldest waiting"
        value={
          stats.oldestPendingAgeSeconds === null
            ? '—'
            : `${Math.round(stats.oldestPendingAgeSeconds)}s`
        }
        tone={stalled ? 'fault' : undefined}
      />

      <p className="health__note caption">
        {stats.failed > 0
          ? 'Some events were given up on. Nothing will retry them on its own — a person has to decide what to do.'
          : stalled
            ? 'Events have been waiting longer than expected. Check that the worker process is running.'
            : 'The queue is draining. Money already moved regardless — delivery is what happens afterwards.'}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'fault' | undefined;
}): JSX.Element {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span
        className={
          tone === 'fault' ? 'metric__value figure metric__value--fault' : 'metric__value figure'
        }
      >
        {value}
      </span>
    </div>
  );
}

function EventTable({ events }: { events: OutboxEvent[] }): JSX.Element {
  return (
    <table className="events-table">
      <caption className="sr-only">
        Outbox events with their delivery status, attempt count and last error.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="label">
            Event
          </th>
          <th scope="col" className="label">
            Transaction
          </th>
          <th scope="col" className="label">
            State
          </th>
          <th scope="col" className="label events-table__numeric">
            Tries
          </th>
          <th scope="col" className="label">
            When
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr
            key={event.id}
            className={`events-table__row events-table__row--${event.status.toLowerCase()}`}
          >
            <td>
              <span className="events-table__type">{event.eventType}</span>
              {event.lastError ? (
                <span className="events-table__error caption">{event.lastError}</span>
              ) : null}
            </td>
            <td className="figure">
              <Link to={`/journal?accountId=${event.aggregateId}`}>
                {shortId(event.aggregateId)}
              </Link>
            </td>
            <td>
              <span className={`chip chip--${event.status.toLowerCase()}`}>
                {stateLabel(event.status)}
              </span>
            </td>
            <td className="figure events-table__numeric">{event.attempts}</td>
            <td>
              <span className="figure">{formatRelative(event.createdAt)}</span>
              <span className="caption events-table__exact figure">
                {formatTimestamp(event.publishedAt ?? event.createdAt)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stateLabel(status: Status): string {
  switch (status) {
    case 'PENDING':
      return 'Waiting';
    case 'PUBLISHED':
      return 'Delivered';
    case 'FAILED':
      return 'Given up';
  }
}
