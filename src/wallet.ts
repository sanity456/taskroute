import { studioDevnet } from "genlayer-js/chains";
import { isWalletAddress } from "./model";

export const CHAIN = studioDevnet;
export const CHAIN_ID = studioDevnet.id;
export const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
export const EXPLORER = "https://explorer-studio-dev.genlayer.com";

export type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (value: unknown) => void): void;
  removeListener?(event: string, listener: (value: unknown) => void): void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isOkxWallet?: boolean;
  providers?: Provider[];
};
export type WalletOption = { id: string; name: string; provider: Provider };

export function watchWallets(update: (options: WalletOption[]) => void) {
  const options: WalletOption[] = [];
  let number = 0;
  const add = (provider: Provider, name: string, id?: string) => {
    if (!provider || typeof provider.request !== "function" || options.some(x => x.provider === provider)) return;
    options.push({ provider, name: name.slice(0, 60), id: id || `injected-${++number}` });
    update([...options]);
  };
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.provider && typeof detail.info?.name === "string") add(detail.provider, detail.info.name, detail.info.uuid);
  };
  const refresh = () => {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const w = window as Window & { ethereum?: Provider; phantom?: { ethereum?: Provider }; okxwallet?: Provider };
    if (w.phantom?.ethereum) add(w.phantom.ethereum, "Phantom");
    if (w.okxwallet) add(w.okxwallet, "OKX Wallet");
    for (const provider of w.ethereum?.providers || []) add(provider, provider.isMetaMask ? "MetaMask" : "Browser wallet");
    if (w.ethereum) add(w.ethereum, w.ethereum.isMetaMask ? "MetaMask" : "Browser wallet");
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.addEventListener("ethereum#initialized", refresh);
  refresh();
  return () => {
    window.removeEventListener("eip6963:announceProvider", announce);
    window.removeEventListener("ethereum#initialized", refresh);
  };
}

export async function assertWallet(provider: Provider, expected: string) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }),
  ]);
  if (Number(chain) !== CHAIN_ID) throw Error("Wallet switched networks. Reconnect on Studio Next (61997).");
  if (!Array.isArray(accounts) || !isWalletAddress(accounts[0]) || accounts[0].toLowerCase() !== expected.toLowerCase())
    throw Error("Wallet account changed. Reconnect before sending a transaction.");
}

export async function connectWallet(provider: Provider): Promise<`0x${string}`> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !isWalletAddress(accounts[0])) throw Error("This wallet did not provide an EVM account.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== CHAIN_ID) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (error) {
      const code = (error as { code?: number; data?: { originalError?: { code?: number } } }).code;
      const inner = (error as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
      if (code !== 4902 && inner !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN_HEX, chainName: "GenLayer Studio Next", nativeCurrency: CHAIN.nativeCurrency, rpcUrls: CHAIN.rpcUrls.default.http, blockExplorerUrls: [EXPLORER] }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    }
  }
  await assertWallet(provider, accounts[0]);
  return accounts[0];
}
