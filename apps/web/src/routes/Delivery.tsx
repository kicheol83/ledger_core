import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Failure, Loading } from '../components/state';
import { useI18n, type Messages } from '../i18n';
import { get } from '../lib/api';
import { formatRelative, formatTimestamp, shortId } from '../lib/money';
import { useAsync, usePolling } from '../lib/useAsync';
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

const FILTERS: Array<Status | 'ALL'> = ['ALL', 'PENDING', 'PUBLISHED', 'FAILED'];

export function Delivery(): JSX.Element {
  const { t } = useI18n();
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
        <h1>{t.navDelivery}</h1>
        <p className="caption">{t.deliveryIntro}</p>
      </header>

      {stats.data ? <Health stats={stats.data} /> : <Loading label={t.queueLoading} />}

      <div className="delivery__controls">
        <div className="segmented" role="tablist" aria-label={t.filterAria}>
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              className={
                filter === option ? 'segmented__item segmented__item--on' : 'segmented__item'
              }
              onClick={() => setFilter(option)}
            >
              {option === 'ALL' ? t.filterAll : stateLabel(t, option)}
            </button>
          ))}
        </div>

        <label className="delivery__live">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          <span className="label">{t.refreshEvery}</span>
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
        <Loading label={t.eventsLoading} />
      ) : events.data && events.data.events.length > 0 ? (
        <EventTable events={events.data.events} />
      ) : (
        <Empty
          title={filter === 'FAILED' ? t.noneGivenUp : t.noEvents}
          action={
            <Link className="button" to="/transfer">
              {t.navTransfer}
            </Link>
          }
        />
      )}
    </div>
  );
}

function Health({ stats }: { stats: Stats }): JSX.Element {
  const { t } = useI18n();
  const stalled = (stats.oldestPendingAgeSeconds ?? 0) > 60;

  return (
    <div className={stalled || stats.failed > 0 ? 'health health--attention' : 'health'}>
      <Metric label={t.waiting} value={String(stats.pending)} />
      <Metric label={t.delivered} value={String(stats.published)} />
      <Metric
        label={t.givenUp}
        value={String(stats.failed)}
        tone={stats.failed > 0 ? 'fault' : undefined}
      />
      <Metric
        label={t.oldestWaiting}
        value={
          stats.oldestPendingAgeSeconds === null
            ? '—'
            : `${Math.round(stats.oldestPendingAgeSeconds)}s`
        }
        tone={stalled ? 'fault' : undefined}
      />

      <p className="health__note caption">
        {stats.failed > 0 ? t.healthFailed : stalled ? t.healthStalled : t.healthOk}
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
  const { t } = useI18n();

  return (
    <table className="events-table">
      <caption className="sr-only">{t.eventsCaption}</caption>
      <thead>
        <tr>
          <th scope="col" className="label">
            {t.event}
          </th>
          <th scope="col" className="label">
            {t.transaction}
          </th>
          <th scope="col" className="label">
            {t.state}
          </th>
          <th scope="col" className="label events-table__numeric">
            {t.tries}
          </th>
          <th scope="col" className="label">
            {t.when}
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
                {stateLabel(t, event.status)}
              </span>
            </td>
            <td className="figure events-table__numeric">{event.attempts}</td>
            <td>
              <span className="figure">{formatRelative(event.createdAt, t.ago)}</span>
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

function stateLabel(t: Messages, status: Status): string {
  switch (status) {
    case 'PENDING':
      return t.waiting;
    case 'PUBLISHED':
      return t.delivered;
    case 'FAILED':
      return t.givenUp;
  }
}
