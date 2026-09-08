export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface PermissionDetails {
  spender: Address;
  token: Address;
  allowance: string;
  salt: string;
  extraData: Hex;
  signature?: Hex;
}

export interface SpendPermissionBatch {
  account: Address;
  period: number;
  start: number;
  end: number;
  permissions: PermissionDetails[];
}

export type Risk = 'conservative' | 'balanced' | 'aggressive';
export type PeriodKey = 'daily' | 'weekly' | 'monthly';
export type ExecutionMode = 'simulation' | 'live';
export interface TransactionStep {
  name: string;
  status: 'prepared' | 'confirmed' | 'failed';
  hash: Hex;
  updatedAt: number;
}

export interface Mandate {
  control?: 'chat' | 'automatic';
  executionMode?: ExecutionMode; // Missing legacy provenance must never activate live.
  transactions?: TransactionStep[];
  id: string;
  account: Address;
  spender: Address;
  budgetUsdc: number;
  period: PeriodKey;
  universe: Address[];
  strategy: string;
  risk: Risk;
  maxPositionPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  batch: SpendPermissionBatch;
  signature?: Hex; // Legacy batch signature.
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'error';
  approvalTx?: string;
  createdAt: number;
  lastRunAt?: number;
  spentThisPeriod?: number;
  periodStart?: number;
}

export interface Position {
  executionMode?: ExecutionMode;
  mandateId: string;
  token: Address;
  symbol: string;
  shares: number; // multiplier-adjusted shares held for this mandate
  raw: string; // raw token units (bigint as string)
  costUsd: number; // total USDC spent
}

export interface Activity {
  id: string;
  mandateId: string;
  account: Address;
  ts: number;
  kind: 'buy' | 'sell' | 'hold' | 'error' | 'approved' | 'revoked' | 'queued' | 'cancelled';
  symbol?: string;
  token?: Address;
  amountUsd?: number;
  qty?: number;
  price?: number;
  rationale: string;
  txHash?: string;
}

export interface Order {
  source?: 'chat';
  transactions?: TransactionStep[];
  riskExit?: 'stop-loss' | 'take-profit';
  id: string;
  account: Address;
  mandateId: string;
  action: 'buy' | 'sell';
  symbol: string;
  token: Address;
  usd?: number;
  fraction?: number;
  rationale: string;
  status: 'queued' | 'executing' | 'filled' | 'cancelled' | 'failed';
  createdAt: number;
  executeAfter: number;
  updatedAt: number;
  dryRun: boolean;
  error?: string;
  txHash?: string;
  filledUsd?: number;
}

export interface PricePoint {
  ts: number;
  prices: Record<string, number>; // token -> USD
}
