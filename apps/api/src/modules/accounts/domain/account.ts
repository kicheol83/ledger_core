import { AccountNotActiveError } from '../../../shared/errors/ledger.errors';

export const ACCOUNT_TYPES = ['USER', 'SYSTEM'] as const;
export const ACCOUNT_STATUSES = ['ACTIVE', 'FROZEN', 'CLOSED'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface AccountProps {
  id: string;
  userId: string | null;
  currency: string;
  type: AccountType;
  status: AccountStatus;
  createdAt: string;
}

export class Account {
  private constructor(private readonly props: AccountProps) {}

  static fromPersistence(props: AccountProps): Account {
    return new Account(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string | null {
    return this.props.userId;
  }

  get currency(): string {
    return this.props.currency;
  }

  get type(): AccountType {
    return this.props.type;
  }

  get status(): AccountStatus {
    return this.props.status;
  }

  get createdAt(): string {
    return this.props.createdAt;
  }

  get isSystem(): boolean {
    return this.props.type === 'SYSTEM';
  }

  get canTransact(): boolean {
    return this.props.status === 'ACTIVE';
  }

  assertCanTransact(): void {
    if (!this.canTransact) {
      throw new AccountNotActiveError(this.props.id, this.props.status);
    }
  }

  holds(currency: string): boolean {
    return this.props.currency === currency;
  }

  toJSON(): AccountProps {
    return { ...this.props };
  }
}
