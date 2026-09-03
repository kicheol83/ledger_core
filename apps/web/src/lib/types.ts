export interface Account {
  id: string;
  userId: string | null;
  currency: string;
  type: 'USER' | 'SYSTEM';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  createdAt: string;
}

export interface Balance {
  accountId: string;
  amount: string;
  currency: string;
  asOfEntryId: string | null;
  entryCount: number;
}

export interface Entry {
  id: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
}

export interface Transaction {
  id: string;
  type: 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL' | 'REVERSAL';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  amount: string;
  currency: string;
  reversesId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  entries?: Entry[];
}

export interface HistoryEntry {
  id: string;
  type: Transaction['type'];
  status: Transaction['status'];
  amount: string;
  currency: string;
  direction: 'DEBIT' | 'CREDIT';
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface Reconciliation {
  currency: string;
  imbalance: string;
  balanced: boolean;
}
