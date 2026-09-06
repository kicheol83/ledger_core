import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
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
  return (
    <div className="stack">
      <h1>No such page</h1>
      <p className="caption">Pick a section from the list on the left.</p>
    </div>
  );
}
