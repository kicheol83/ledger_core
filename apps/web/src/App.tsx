import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { useI18n } from './i18n';
import { Accounts } from './routes/Accounts';
import { Delivery } from './routes/Delivery';
import { Journal } from './routes/Journal';
import { Transfer } from './routes/Transfer';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/accounts" replace />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="transfer" element={<Transfer />} />
        <Route path="journal" element={<Journal />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound(): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="stack">
      <h1>{t.notFoundTitle}</h1>
      <p className="caption">{t.notFoundHint}</p>
    </div>
  );
}
