import './state.css';

export function Loading({ label }: { label: string }): JSX.Element {
  return (
    <p className="state state--loading caption" role="status">
      {label}
    </p>
  );
}

export function Empty({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode | undefined;
}): JSX.Element {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {action}
    </div>
  );
}

export function Failure({
  message,
  code,
  traceId,
  onRetry,
}: {
  message: string;
  code?: string | undefined;
  traceId?: string | undefined;
  onRetry?: (() => void) | undefined;
}): JSX.Element {
  return (
    <div className="state state--failure" role="alert">
      <p className="state__title">{message}</p>
      {code ? <p className="caption figure">{code}</p> : null}
      {traceId ? <p className="caption figure">Trace {traceId}</p> : null}
      {onRetry ? (
        <button type="button" className="state__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
