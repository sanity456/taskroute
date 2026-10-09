import { abi, createClient, createFeesDistribution, normalizeMessageFeeAllocations } from "genlayer-js";
import { TransactionHashVariant, type TransactionHash } from "genlayer-js/types";
import { formatUnits } from "viem";
import { CHAIN, CHAIN_ID, type Provider, assertWallet } from "./wallet";
import { retryRead } from "./retry";
import { isCompatiblePolicy } from "./policy";

export const CONTRACT = import.meta.env.VITE_TASKROUTE_CONTRACT || "";
export const configured = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT) && !/^0x0{40}$/i.test(CONTRACT);
const reader = createClient({ chain: CHAIN });

export function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

export function executionSucceeded(value: unknown) {
  const record = plain(value) as Record<string, unknown>;
  const result = record?.txExecutionResultName ?? record?.txExecutionResult;
  if (result != null) return result === 1 || result === "FINISHED_WITH_RETURN" || result === "SUCCESS";
  const data = record.consensus_data as { leader_receipt?: { execution_result?: string }[] | { execution_result?: string } } | undefined;
  const rows = data?.leader_receipt ? Array.isArray(data.leader_receipt) ? data.leader_receipt : [data.leader_receipt] : [];
  return rows.length > 0 && rows.every(r => r.execution_result === "SUCCESS" || r.execution_result === "FINISHED_WITH_RETURN");
}

export async function read<T>(method: string, args: (string | number)[] = []): Promise<T> {
  if (!configured) throw Error("The live contract address has not been configured.");
  return plain(await reader.readContract({ address: CONTRACT as `0x${string}`, functionName: method, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL })) as T;
}

export async function assertCompatibleContract(): Promise<void> {
  const policy = await read<{ decision_schema?: string; rules_version?: number }>("get_policy");
  if (!isCompatiblePolicy(policy))
    throw Error("The configured TaskRoute contract is the older v1 build. Deploy v2 and update VITE_TASKROUTE_CONTRACT before sending transactions.");
}

export async function quoteAndSubmit(provider: Provider, account: `0x${string}`, method: string,
  args: (string | boolean)[], onQuote: (message: string) => void): Promise<`0x${string}`> {
  if (!configured) throw Error("Live transactions are available after contract deployment.");
  if (Number(await reader.request({ method: "eth_chainId" })) !== CHAIN_ID) throw Error("Studio Next RPC chain mismatch.");
  await assertCompatibleContract();
  await assertWallet(provider, account);
  const client = createClient({ chain: CHAIN, account, provider: provider as NonNullable<NonNullable<Parameters<typeof createClient>[0]>["provider"]> });
  onQuote("Simulating the action and calculating the Studio Next protocol fee…");
  const baseline = await client.estimateTransactionFees();
  const block = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { timestamp?: string };
  if (!block?.timestamp || !/^0x[0-9a-f]+$/i.test(block.timestamp)) throw Error("Could not read chain time for the simulation.");
  const timestamp = Number(BigInt(block.timestamp));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw Error("Invalid chain timestamp.");
  const data = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(method, args, undefined)), false]);
  const fees = JSON.parse(JSON.stringify({ distribution: baseline.distribution, feeValue: baseline.feeValue, messageAllocations: baseline.messageAllocations }, (_, v) => typeof v === "bigint" ? v.toString() : v));
  let simulation: { receipt?: { execution_result?: string }; recommendedPreset?: { distribution?: Parameters<typeof createFeesDistribution>[0]; feeValue?: string | number; messageAllocations?: Parameters<typeof normalizeMessageFeeAllocations>[0] } };
  try {
    simulation = await client.request({ method: "sim_estimateTransactionFees", params: [{ type: "write", to: CONTRACT, from: account, data, transaction_hash_variant: "latest-final", fees,
      sim_config: { genvm_datetime: new Date(timestamp * 1000).toISOString() } }] }) as typeof simulation;
  } catch (error) {
    const encoded = (error as { cause?: { data?: { receipt?: { result?: unknown } } } }).cause?.data?.receipt?.result;
    let detail = "";
    if (typeof encoded === "string") {
      try { detail = new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))).replace(/[\x00-\x1f]+/g, " ").trim(); }
      catch { /* Fall back to the RPC's readable message below. */ }
    }
    if (detail.includes("[LLM_ERROR] INVALID_LINE"))
      throw Error("GenLayer could not produce a valid shared brief during simulation. No transaction was sent; retry after the contract update.");
    throw Error(`Studio Next simulation failed${detail ? `: ${detail}` : ""}. No transaction was sent.`);
  }
  const preset = simulation.recommendedPreset;
  if (simulation.receipt?.execution_result !== "SUCCESS" || !preset?.distribution || preset.feeValue == null || !/^\d+$/.test(String(preset.feeValue)))
    throw Error("The contract simulation failed. No transaction was sent.");
  const feeValue = BigInt(preset.feeValue);
  if (feeValue > 1000000000000000000n) throw Error("Quote exceeds 1 test GEN. No transaction was sent.");
  const balanceRaw = await reader.request({ method: "eth_getBalance", params: [account, "pending"] });
  if (typeof balanceRaw !== "string" || !/^0x[0-9a-f]+$/i.test(balanceRaw) || BigInt(balanceRaw) < feeValue)
    throw Error("Not enough test GEN on Studio Next for this protocol fee.");
  await assertWallet(provider, account);
  onQuote(`Review ${method.replaceAll("_", " ")} in your wallet on Studio Next. Protocol deposit: ${formatUnits(feeValue, 18)} test GEN.`);
  return client.writeContract({ address: CONTRACT as `0x${string}`, functionName: method, args,
    value: 0n, leaderOnly: false,
    fees: { distribution: createFeesDistribution(preset.distribution), feeValue,
      messageAllocations: preset.messageAllocations ? normalizeMessageFeeAllocations(preset.messageAllocations) : undefined } });
}

export async function waitFinal(hash: `0x${string}`, onStatus: (status: string) => void): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error("Invalid transaction hash.");
  for (let attempt = 0; attempt < 120; attempt++) {
    const receipt = plain(await retryRead(
      () => reader.getTransaction({ hash: hash as TransactionHash }),
      attempt => onStatus(`NETWORK RETRY ${attempt}/4`),
      () => new Promise(resolve => setTimeout(resolve, 6000)),
    )) as Record<string, unknown>;
    const status = String(receipt.statusName ?? receipt.status ?? "UNKNOWN").toUpperCase();
    onStatus(status);
    if (status === "FINALIZED") {
      if (!executionSucceeded(receipt)) throw Error("Finalized with an execution error. State did not change.");
      return;
    }
    if (status === "CANCELED" || status === "UNDETERMINED") throw Error(`Transaction ${status.toLowerCase()}. State did not change.`);
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
  throw Error("Still pending. Keep this transaction hash and resume tracking; do not submit again.");
}
