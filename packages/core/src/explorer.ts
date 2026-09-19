const STELLAR_EXPERT = "https://stellar.expert/explorer/testnet";
const BASESCAN = "https://sepolia.basescan.org";

export const stellarTxUrl = (hash: string) => `${STELLAR_EXPERT}/tx/${hash}`;
export const stellarContractUrl = (id: string) => `${STELLAR_EXPERT}/contract/${id}`;
export const stellarAccountUrl = (g: string) => `${STELLAR_EXPERT}/account/${g}`;
export const baseTxUrl = (hash: string) => `${BASESCAN}/tx/${hash}`;
export const baseAddressUrl = (addr: string) => `${BASESCAN}/address/${addr}`;
