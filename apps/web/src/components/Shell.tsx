import { NavLink, Outlet } from 'react-router-dom';
import { LANGS, useI18n } from '../i18n';
import './Shell.css';

export function Shell(): JSX.Element {
  const { t, lang, setLang } = useI18n();

  const nav = [
    { to: '/accounts', label: t.navAccounts, hint: t.navAccountsHint },
    { to: '/transfer', label: t.navTransfer, hint: t.navTransferHint },
    { to: '/journal', label: t.navJournal, hint: t.navJournalHint },
    { to: '/delivery', label: t.navDelivery, hint: t.navDeliveryHint },
  ];

  return (
    <div className="shell">
      <a className="shell__skip" href="#main">
        {t.skip}
      </a>

      <header className="shell__masthead">
        <div className="shell__mark">
          <span className="shell__mark-debit" aria-hidden="true" />
          <span className="shell__mark-rule" aria-hidden="true" />
          <span className="shell__mark-credit" aria-hidden="true" />
          <span className="shell__wordmark">LedgerCore</span>
        </div>
        <p className="shell__strapline caption">{t.strapline}</p>
        <div className="shell__lang" role="group" aria-label={t.langAria}>
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className={
                code === lang ? 'shell__lang-item shell__lang-item--on' : 'shell__lang-item'
              }
              aria-pressed={code === lang}
              onClick={() => setLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <nav className="shell__nav" aria-label={t.navAria}>
        <ul>
          {nav.map((item) => (
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
