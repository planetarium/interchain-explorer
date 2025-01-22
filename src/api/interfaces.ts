export type ChainType = 'ethereum' | 'bsc' | 'arbitrum' | 'base';

export interface TokenInfo {
  tokenName: string;
  tokenSymbol: string;
}

export interface TransactionResponse {
  address: string;
  id: string;
  name: string;
  chain: ChainType;
  value: string;
  timestamp: number;
  hash: string;
} 