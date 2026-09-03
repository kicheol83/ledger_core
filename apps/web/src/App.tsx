import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.js';
import { Accounts } from './routes/Accounts.js';
import { Delivery } from './routes/Delivery.js';
import { Journal } from './routes/Journal.js';
import { Transfer } from './routes/Transfer.js';

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
