/**
 * Deploys a SECOND instance of OpenZeppelin's spending_limit policy (same wasm as SMART_ACCOUNT.spendingLimitPolicy).
 * A context rule maps policy address → params, so one instance can hold only one window per rule; the weekly
 * limit therefore needs its own instance. The policy keeps its data per (smart account, rule), so one shared
 * instance serves every user. Idempotent: the salt is fixed, a second run just prints the same address.
 *
 *   pnpm --filter @pera/scripts exec tsx deploy-weekly-policy.ts
 */
import { Address, Keypair, Networks, Operation, StrKey, TransactionBuilder, hash, rpc, xdr } from "@stellar/stellar-sdk";
import { loadEnv, SMART_ACCOUNT } from "@pera/core";

const env = loadEnv();
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const sponsor = Keypair.fromSecret(env.SPONSOR_SECRET);
const salt = hash(Buffer.from("pera:spending-limit:weekly:v1"));

const wasm = await server.getContractWasmByContractId(SMART_ACCOUNT.spendingLimitPolicy);
const wasmHash = hash(wasm);

// the address a (deployer, salt) pair produces is deterministic
const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
  new xdr.HashIdPreimageContractId({
    networkId: hash(Buffer.from(Networks.TESTNET)),
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: new Address(sponsor.publicKey()).toScAddress(), salt })),
  }),
);
const contractId = StrKey.encodeContract(hash(preimage.toXDR()));

const exists = await server.getContractWasmByContractId(contractId).then(() => true).catch(() => false);
if (exists) {
  console.log(`already deployed: ${contractId}`);
} else {
  const account = await server.getAccount(sponsor.publicKey());
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.createCustomContract({ address: new Address(sponsor.publicKey()), wasmHash, salt }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(sponsor);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== "SUCCESS") throw new Error(`deploy ${res.status} (${sent.hash})`);
  console.log(`deployed ${contractId}\n  tx https://stellar.expert/explorer/testnet/tx/${sent.hash}`);
}
console.log(`wasm ${wasmHash.toString("hex")} (same as ${SMART_ACCOUNT.spendingLimitPolicy})`);
