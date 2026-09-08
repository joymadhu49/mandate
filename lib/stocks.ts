// Coinbase Tokenized Stocks on Base (B20 tokens) + Chainlink total-return feeds.
// Source: https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base
// Always identify tokens by address, never by symbol (metadata is mutable onchain).

export type Address = `0x${string}`;

export interface Stock {
  symbol: string; // onchain symbol, e.g. NVDAc
  name: string;
  token: Address;
  feed: Address; // Chainlink V3 aggregator proxy, 8 decimals, 24/5
}

export const CHAIN_ID = 8453;

export const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const B20_REGISTRY: Address = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD';
export const SPEND_PERMISSION_MANAGER: Address =
  '0xf85210B21cC50302F477BA56686d2019dC9b67Ad';

export const STOCKS: Stock[] = [
  { symbol: 'AAPLc', name: 'Apple', token: '0xb200000000000000000000C2e324d24d7eEcd1fb', feed: '0x787f13dEa48Db0897CbCDD985de77809D837F988' },
  { symbol: 'AMZNc', name: 'Amazon', token: '0xb200000000000000000000d9192b6B456483C2E8', feed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295' },
  { symbol: 'COINc', name: 'Coinbase', token: '0xb200000000000000000000c85a31389D71F3ecfb', feed: '0x408e44f504A7371a345F03a73dDC96A4b48e8aa7' },
  { symbol: 'CRCLc', name: 'Circle', token: '0xB20000000000000000000019f6E7C675b73C2e4D', feed: '0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33' },
  { symbol: 'GOOGLc', name: 'Alphabet', token: '0xb2000000000000000000002D0BA3164cc74f58B7', feed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2' },
  { symbol: 'INTCc', name: 'Intel', token: '0xB2000000000000000000004AFF16039bA04bdFBc', feed: '0xAB657C39bac0D5886250D70849e2E3E008F2EECB' },
  { symbol: 'METAc', name: 'Meta', token: '0xb2000000000000000000008bC8786B856E61707C', feed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D' },
  { symbol: 'MSFTc', name: 'Microsoft', token: '0xB200000000000000000000Ab99cFa739E253872B', feed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c' },
  { symbol: 'MSTRc', name: 'Strategy', token: '0xb2000000000000000000004884b426556b92883d', feed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a' },
  { symbol: 'NVDAc', name: 'NVIDIA', token: '0xb20000000000000000000078ee7ce2fE4908108C', feed: '0x04689a41629776563E6822F76f2e57D148d28513' },
  { symbol: 'SNDKc', name: 'SanDisk', token: '0xb200000000000000000000397293Cb8cda9a10c5', feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA' },
  { symbol: 'SPCXc', name: 'SpaceX', token: '0xb2000000000000000000007b9fcbd005511aCBd5', feed: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68' },
  { symbol: 'TSLAc', name: 'Tesla', token: '0xb2000000000000000000001e800a7f5189430cD0', feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4' },
];

export const stockByToken = (token: string) =>
  STOCKS.find((s) => s.token.toLowerCase() === token.toLowerCase());
