import { NavLink, Outlet } from 'react-router-dom';
import './Shell.css';

const NAV = [
  { to: '/accounts', label: 'Accounts', hint: 'Balances derived from entries' },
  { to: '/transfer', label: 'Move money', hint: 'Transfer, deposit, withdraw' },
  { to: '/journal', label: 'Journal', hint: 'Every transaction, both sides' },
  { to: '/delivery', label: 'Delivery', hint: 'Outbox events and dead letters' },
];

export function Shell(): JSX.Element {
  return (
    <div className="shell">
      <a className="shell__skip" href="#main">
        Skip to content
      </a>

      <header className="shell__masthead">
        <div className="shell__mark">
          <span className="shell__mark-debit" aria-hidden="true" />
          <span className="shell__mark-rule" aria-hidden="true" />
          <span className="shell__mark-credit" aria-hidden="true" />
          <span className="shell__wordmark">LedgerCore</span>
        </div>
        <p className="shell__strapline caption">
          Every amount here is derived from the entry log. Nothing is stored as a total.
        </p>
      </header>

      <nav className="shell__nav" aria-label="Sections">
        <ul>
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'shell__link shell__link--active' : 'shell__link'
                }
              >
                <span className="shell__link-label">{item.label}</span>
                <span className="shell__link-hint">{item.hint}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="shell__main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
