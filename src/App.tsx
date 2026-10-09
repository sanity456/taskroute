import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CircleHelp, GitBranch, LoaderCircle, LockKeyhole, Network, RefreshCw, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { assertCompatibleContract, configured, CONTRACT, quoteAndSubmit, read, waitFinal } from "./chain";
import { CHAIN_ID, EXPLORER, Provider, WalletOption, connectWallet, watchWallets } from "./wallet";
import { rememberedTaskKey, taskStorageKey, validTaskKey } from "./task-link";
import "./lifecycle.css";

type Candidate = { id: string; name: string; address: string; output: string; accent: string };
type Score = { id: string; score: number; missing_indices: number[] };
type TaskResult = { task_id: string; storage_id?: string; creator?: string; task?: string; status: string; selected_address: string; claimed_by?: string; decision: { status: string; selected_id: string; scores: Score[]; reason: string }; candidates: Candidate[]; requirements: string[]; evaluation: unknown; delivery: string; delivery_history?: { delivery: string; evaluation: unknown }[] };

const SAMPLE_TASK = "Create a fact-safe comparison table for three laptop models. Include price, battery life and warranty. Mark unavailable values as unknown; never invent specifications.";
const SAMPLE_REQUIREMENTS = ["Include price, battery life and warranty for each model.", "Use only facts present in the source material.", "Clearly mark missing values as unknown."];
const DEFAULT_CANDIDATES: Candidate[] = [
  { id: "fact-table", name: "FactTable Agent", address: "0x1111111111111111111111111111111111111111", accent: "gold", output: "A clean comparison table with price, battery life, warranty, and an Unknown marker wherever the source omits a value. No additional specifications are added." },
  { id: "fast-summary", name: "FastSummary Agent", address: "0x2222222222222222222222222222222222222222", accent: "blue", output: "A short prose summary of the laptops. It includes prices and battery claims, but warranty coverage is not listed for every model." },
  { id: "creative-copy", name: "CreativeCopy Agent", address: "0x3333333333333333333333333333333333333333", accent: "rose", output: "An engaging buying guide with confident performance and warranty statements. Some details are inferred from typical models rather than the provided source." },
];
const SAMPLE_ADDRESSES = new Set(DEFAULT_CANDIDATES.map(candidate => candidate.address.toLowerCase()));
const ACCENTS = ["gold", "blue", "rose", "gold", "blue"];

const trimAddress = (value: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";
const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const words = (value: string) => value.toLowerCase().match(/[a-z0-9]{4,}/g) || [];

function previewScore(requirement: string, output: string) {
  const terms = [...new Set(words(requirement))];
  const text = output.toLowerCase();
  const matches = terms.filter(term => text.includes(term));
  return terms.length ? matches.length / terms.length : 0;
}

export default function App() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [walletMenu, setWalletMenu] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [account, setAccount] = useState("");
  const [task, setTask] = useState(SAMPLE_TASK);
  const [requirements, setRequirements] = useState(SAMPLE_REQUIREMENTS.join("\n"));
  const [candidates, setCandidates] = useState(DEFAULT_CANDIDATES);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [delivery, setDelivery] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [contractStatus, setContractStatus] = useState<"checking" | "live" | "error">("checking");

  const requirementLines = useMemo(() => requirements.split(/\r?\n/).map(line => line.trim()).filter(Boolean), [requirements]);
  const preview = !configured;
  const selectedId = result?.decision?.selected_id || "fact-table";

  const useTaskRecord = (record: TaskResult, storageId: string) => {
    setResult(record);
    setTask(record.task || "");
    setRequirements(record.requirements.join("\n"));
    setCandidates(record.candidates.map((candidate, index) => ({ ...candidate, accent: ACCENTS[index % ACCENTS.length] })));
    setActiveCandidate(0);
    setDelivery(record.status === "REJECTED" ? record.delivery : "");
    setLookupId(storageId);
    window.localStorage.setItem(taskStorageKey(CONTRACT), storageId);
    const url = new URL(window.location.href);
    url.searchParams.set("task", storageId);
    window.history.replaceState(null, "", url);
  };

  const loadTask = async (taskKey: string) => {
    const storageId = taskKey.trim().toLowerCase();
    setError(""); setNotice("");
    if (!validTaskKey(storageId)) { setError("Enter a complete task ID: creator wallet address, a colon, then the task name."); return; }
    if (preview) { setError("Deploy and configure a contract before loading an on-chain task."); return; }
    setBusy(true);
    try {
      await assertCompatibleContract();
      setContractStatus("live");
      const record = await read<TaskResult>("get_task", [storageId]);
      if (record.storage_id?.toLowerCase() !== storageId) throw Error("The returned task ID did not match the request.");
      useTaskRecord(record, storageId);
      setNotice("On-chain task loaded. Connect the creator or selected agent wallet for the next signed action.");
    } catch (e) {
      setContractStatus(current => current === "live" ? current : "error");
      setError(`Could not load this task from the configured contract: ${(e as Error).message}`);
    }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!configured) return;
    const saved = rememberedTaskKey(window.location.search, window.localStorage.getItem(taskStorageKey(CONTRACT)));
    if (saved) void loadTask(saved);
    else void assertCompatibleContract().then(() => setContractStatus("live")).catch(e => {
      setContractStatus("error");
      setError((e as Error).message);
    });
  }, []);

  useEffect(() => watchWallets(setWallets), []);
  useEffect(() => {
    if (!provider || !account) return;
    const resetIfChanged = (value: unknown) => {
      const next = Array.isArray(value) ? String(value[0] || "") : "";
      if (next.toLowerCase() !== account.toLowerCase()) { setAccount(""); setProvider(null); setError("Wallet account changed. Reconnect before signing."); }
    };
    const resetIfChainChanged = (value: unknown) => {
      if (Number(value) !== CHAIN_ID) { setAccount(""); setProvider(null); setError(`Switch back to Studio Next (${CHAIN_ID}) before signing.`); }
    };
    provider.on?.("accountsChanged", resetIfChanged);
    provider.on?.("chainChanged", resetIfChainChanged);
    return () => { provider.removeListener?.("accountsChanged", resetIfChanged); provider.removeListener?.("chainChanged", resetIfChainChanged); };
  }, [provider, account]);

  const connect = async (option: WalletOption) => {
    setError("");
    setWalletMenu(false);
    try {
      const address = await connectWallet(option.provider);
      setProvider(option.provider);
      setAccount(address);
      setNotice(`Connected ${trimAddress(address)} on Studio Next (${CHAIN_ID}).`);
    } catch (e) { setError((e as Error).message); }
  };

  const updateCandidate = (index: number, field: keyof Candidate, value: string) => {
    setCandidates(current => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, [field]: value } : candidate));
  };

  const demoResult = (): TaskResult => {
    const scores = candidates.map(candidate => {
      const missing_indices = requirementLines.map((requirement, index) => previewScore(requirement, candidate.output) < .34 ? index + 1 : 0).filter(Boolean);
      const suspicious = /invent|inferred|typical|guess/i.test(candidate.output) ? 14 : 0;
      const rawScore = Math.max(0, Math.min(100, Math.round((1 - missing_indices.length / Math.max(1, requirementLines.length)) * 100 - suspicious)));
      const score = Math.floor(rawScore / 10) * 10;
      return { id: candidate.id, score, missing_indices };
    });
    const winner = scores.filter(score => score.score >= 70 && score.missing_indices.length === 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
    const status = winner ? "ROUTED" : "NO_MATCH";
    return {
    task_id: "preview-laptop-facts",
    task,
    status,
    selected_address: winner ? candidates.find(candidate => candidate.id === winner.id)?.address || "" : "",
    requirements: requirementLines,
    candidates,
    delivery: "",
    evaluation: {},
    decision: {
      status,
      selected_id: winner?.id || "",
      reason: winner ? `${winner.id} covers every requirement in the edited trial set.` : "No trial output covers every requirement with a qualifying score.",
      scores,
    },
    };
  };

  const route = async () => {
    setError(""); setNotice(""); setTxHash("");
    if (task.trim().length < 20 || requirementLines.length < 1 || requirementLines.length > 6) { setError("Add a task of at least 20 characters and 1–6 requirements."); return; }
    if (candidates.length < 2 || candidates.some(candidate => !validAddress(candidate.address))) { setError("Each candidate needs a valid EVM address before routing."); return; }
    if (preview) { setResult(demoResult()); setDelivery(""); setNotice("Preview decision updated from the current requirements and trial outputs. Deploy a contract to enable live consensus."); return; }
    if (candidates.some(candidate => SAMPLE_ADDRESSES.has(candidate.address.toLowerCase()))) { setError("Replace every sample agent address with a wallet its agent controls before a live route. The selected wallet must sign the claim and delivery."); return; }
    if (!provider || !account) { setError("Connect a wallet before requesting a live route."); return; }
    if (result?.status === "NO_MATCH" && result.task === task && JSON.stringify(result.requirements) === JSON.stringify(requirementLines) && result.creator?.toLowerCase() !== account.toLowerCase()) { setError("Reconnect the task creator wallet to reroute this NO_MATCH task."); return; }
    setBusy(true);
    try {
      const payload = candidates.map(({ id, name, address, output }) => ({ id, name, address, output }));
      const sameSpec = result?.task === task && JSON.stringify(result.requirements) === JSON.stringify(requirementLines);
      const existingId = result?.status === "NO_MATCH" && sameSpec ? result.storage_id : "";
      const method = existingId ? "reroute_task" : "route_task";
      const taskId = `task-${Date.now().toString(36)}`;
      const args = existingId ? [existingId, JSON.stringify(payload)] : [taskId, task, JSON.stringify(requirementLines), JSON.stringify(payload)];
      const hash = await quoteAndSubmit(provider, account as `0x${string}`, method, args, message => setNotice(message));
      setTxHash(hash); setNotice("Consensus transaction submitted. Waiting for the final route decision…");
      await waitFinal(hash, status => setNotice(`Route transaction: ${status}`));
      const storageId = existingId || `${account.toLowerCase()}:${taskId}`;
      useTaskRecord(await read<TaskResult>("get_task", [storageId]), storageId);
      setNotice("Route finalized. The selected agent and validator evidence are now recorded on-chain.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const runAction = async (method: string, args: string[], success: string, localStatus: string) => {
    setError(""); setNotice("");
    if (preview) { setResult(current => current ? { ...current, status: localStatus, claimed_by: localStatus === "CLAIMED" ? current.selected_address : current.claimed_by, delivery: localStatus === "DELIVERED" ? delivery : current.delivery, evaluation: localStatus === "ACCEPTED" ? { status: "ACCEPTED", missing_indices: [], reason: "Preview delivery covers the current requirements." } : current.evaluation } : current); setNotice(success); return; }
    if (!provider || !account || !result?.storage_id) { setError("Connect a Studio Next wallet before signing."); return; }
    if (method === "claim_task" && account.toLowerCase() !== result.selected_address.toLowerCase()) { setError("Connect the wallet assigned by the route before claiming."); return; }
    if (method === "submit_delivery" && account.toLowerCase() !== result.selected_address.toLowerCase()) { setError("Connect the assigned agent wallet before submitting the delivery."); return; }
    setBusy(true);
    try {
      const hash = await quoteAndSubmit(provider, account as `0x${string}`, method, args, message => setNotice(message));
      setTxHash(hash); await waitFinal(hash, status => setNotice(`${method.replaceAll("_", " ")}: ${status}`));
      setResult(await read<TaskResult>("get_task", [result.storage_id])); setNotice(success);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const claim = () => { if (result?.storage_id) void runAction("claim_task", [result.storage_id], "Task claimed by the selected agent.", "CLAIMED"); };
  const submit = () => {
    if (delivery.trim().length < 20) { setError("Add a delivery of at least 20 characters before submitting."); return; }
    if (result?.storage_id) void runAction("submit_delivery", [result.storage_id, delivery], "Delivery submitted for independent review.", "DELIVERED");
  };
  const verify = () => {
    if (!result) return;
    if (preview) {
      const missing_indices = requirementLines.map((requirement, index) => previewScore(requirement, delivery) < .2 ? index + 1 : 0).filter(Boolean);
      const status = missing_indices.length ? "REJECTED" : "ACCEPTED";
      setResult({ ...result, status, delivery, evaluation: { status, missing_indices, reason: missing_indices.length ? "The preview delivery still misses one or more requirements." : "The preview delivery covers the current requirements." } });
      setNotice(status === "ACCEPTED" ? "Preview delivery accepted." : "Preview delivery rejected; edit it and resubmit.");
      return;
    }
    if (result.storage_id) void runAction("verify_delivery", [result.storage_id], "Delivery verification finalized.", "ACCEPTED");
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark"><GitBranch size={19}/></span><span>Task<span>Route</span></span></a>
      <nav><a href="#route">Route a task</a><a href="#evidence">Evidence</a><a href="#protocol">Protocol</a></nav>
      <div className="wallet-wrap"><span className="network"><span className="network-dot"/>Studio Next</span><button className="wallet-button" onClick={() => setWalletMenu(value => !value)}><Wallet size={15}/>{account ? trimAddress(account) : "Connect wallet"}</button>{walletMenu && <div className="wallet-menu"><strong>Choose a wallet</strong>{wallets.length ? wallets.map(wallet => <button key={wallet.id} onClick={() => void connect(wallet)}>{wallet.name}<ArrowRight size={14}/></button>) : <p>No injected EVM wallet found.</p>}</div>}</div>
    </header>
    <main id="top">
      <section className="hero"><div className="hero-grid"><div><div className="eyebrow"><Sparkles size={14}/> VERIFIED AGENT ROUTING</div><h1>Send each task<br/><em>to the right agent.</em></h1><p>TaskRoute compares real trial outputs against a fixed task specification. GenLayer validators agree on the route, record the reason, and keep the decision auditable.</p><a className="hero-link" href="#route">Try the workspace <ArrowRight size={16}/></a></div><div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="agent-pill pill-one"><span className="pill-dot gold"/><strong>FactTable</strong><small>90s · qualifies</small></div><div className="agent-pill pill-two"><span className="pill-dot blue"/><strong>FastSummary</strong><small>50s · missing 1</small></div><div className="route-core"><GitBranch size={25}/><span>CONSENSUS<br/>ROUTE</span></div></div></div></section>
      <section className="workspace" id="route"><div className="section-heading"><div><span className="kicker">THE ROUTING DESK</span><h2>Give the task a fair test.</h2><p>Freeze the requirements, compare trial outputs, then ask GenLayer to choose.</p></div><div className={`mode-chip ${preview ? "preview" : contractStatus === "error" ? "outdated" : contractStatus}`} aria-live="polite"><span/> {preview ? "Preview mode" : contractStatus === "checking" ? "Checking contract…" : contractStatus === "live" ? "Live contract" : "Contract check failed"}</div></div>
        {!preview && <div className="task-loader"><label htmlFor="task-key">Open an existing on-chain task</label><div><input id="task-key" value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="0xCreatorAddress:task-id"/><button onClick={() => void loadTask(lookupId)} disabled={busy}>Load task</button></div><small>Bookmark or share the task URL to resume after a refresh or from the selected agent wallet.</small></div>}
        {(error || notice) && <div className={`notice ${error ? "error" : ""}`}>{error || notice}{txHash && <a href={`${EXPLORER}/transactions/${txHash}`} target="_blank" rel="noreferrer">View transaction</a>}</div>}
        <div className="desk-grid"><section className="card task-card"><div className="card-head"><div><span className="kicker">01 · TASK SPECIFICATION</span><h3>What must be done?</h3></div><CircleHelp size={18}/></div><label>Task brief<textarea value={task} onChange={event => setTask(event.target.value)} rows={5}/></label><label>Requirements <span className="label-note">one per line</span><textarea value={requirements} onChange={event => setRequirements(event.target.value)} rows={5}/></label><div className="spec-footer"><span><LockKeyhole size={14}/> Requirements are fixed before judging</span><span>{requirementLines.length}/6</span></div></section>
          <section className="card candidates-card" id="evidence"><div className="card-head"><div><span className="kicker">02 · TRIAL EVIDENCE</span><h3>Compare the candidates.</h3></div><span className="candidate-count">{candidates.length} agents</span></div><p className="helper">Trial outputs are public evidence. Validators check coverage and hallucination risk against the requirements.</p><div className="candidate-tabs">{candidates.map((candidate, index) => <button key={candidate.id} className={activeCandidate === index ? "active" : ""} onClick={() => setActiveCandidate(index)}><span className={`pill-dot ${candidate.accent}`}/>{candidate.name}</button>)}</div><div className="candidate-detail"><div className="candidate-title"><div><strong>{candidates[activeCandidate].name}</strong><span>{candidates[activeCandidate].id}</span></div><span className="address">{trimAddress(candidates[activeCandidate].address)}</span></div><label>Agent wallet<input value={candidates[activeCandidate].address} onChange={event => updateCandidate(activeCandidate, "address", event.target.value)}/></label><label>Trial output<textarea value={candidates[activeCandidate].output} onChange={event => updateCandidate(activeCandidate, "output", event.target.value)} rows={6}/></label></div><button className="route-button" onClick={() => void route()} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17}/> Waiting for consensus…</> : <><ShieldCheck size={17}/> {preview ? "Run preview route" : "Request verified route"}<ArrowRight size={17}/></>}</button></section>
          <aside className="card protocol-card" id="protocol"><div className="card-head"><div><span className="kicker">03 · SHARED OUTCOME</span><h3>What the chain decides.</h3></div><Network size={18}/></div>{result ? <div className="result"><div className="result-status"><span className="status-check"><Check size={16}/></span><div><strong>{result.status === "NO_MATCH" ? "No agent qualified" : result.status === "ACCEPTED" ? "Delivery accepted" : result.status === "REJECTED" ? "Delivery needs revision" : result.status === "DELIVERED" ? "Delivery ready for review" : result.status === "CLAIMED" ? "Task claimed" : "Agent routed"}</strong><small>{result.status === "NO_MATCH" ? result.decision.reason : result.status === "ROUTED" ? result.decision.reason : typeof result.evaluation === "object" && result.evaluation && "reason" in result.evaluation ? String((result.evaluation as { reason?: string }).reason || "") : "The task is moving through the verified delivery flow."}</small></div></div><div className="score-list">{result.decision.scores.map(score => <div className="score-row" key={score.id}><span>{score.id}</span><strong className={score.id === selectedId ? "winner" : ""}>{score.score}</strong><small>{score.missing_indices.length ? `${score.missing_indices.length} missing` : "all covered"}</small></div>)}</div>{result.status === "NO_MATCH" ? <div className="lifecycle-actions"><p className="action-help">Change the evidence above, then ask the creator-scoped task to rerun.</p><button className="small-action" onClick={() => void route()} disabled={busy}><RefreshCw size={14}/> Reroute current evidence</button></div> : <div className="lifecycle-actions"><div className="lifecycle"><span className={result.status !== "ROUTED" ? "done" : "current"}>1 Route</span><span className={["CLAIMED","DELIVERED","ACCEPTED","REJECTED"].includes(result.status) ? "done" : ""}>2 Claim</span><span className={["DELIVERED","ACCEPTED","REJECTED"].includes(result.status) ? "done" : ""}>3 Deliver</span><span className={["ACCEPTED","REJECTED"].includes(result.status) ? "done" : ""}>4 Review</span></div>{result.status === "ROUTED" && <><p className="action-help">The assigned address is {trimAddress(result.selected_address)}.</p><button className="small-action" onClick={claim} disabled={busy}><LockKeyhole size={14}/> Claim task</button></>}{["CLAIMED","REJECTED"].includes(result.status) && <><label className="delivery-label">Delivery<textarea value={delivery} onChange={event => setDelivery(event.target.value)} rows={4} placeholder="Paste the agent's completed work…"/></label><button className="small-action" onClick={submit} disabled={busy}><ArrowRight size={14}/> Submit delivery</button></>}{result.status === "DELIVERED" && <button className="small-action" onClick={verify} disabled={busy}><ShieldCheck size={14}/> Verify delivery</button>}{result.status === "ACCEPTED" && <div className="decision-note"><Check size={14}/> The accepted delivery is recorded as the task outcome.</div>}</div>}<div className="decision-note"><LockKeyhole size={14}/> {result.status === "NO_MATCH" ? "No address is authorized until a candidate qualifies." : "Route, claim, delivery and review are recorded against this task."}</div></div> : <div className="empty-result"><div className="empty-icon"><GitBranch size={22}/></div><strong>Waiting for a route</strong><p>Run the trial set to see the shared decision, scores and missing requirements.</p><div className="mini-steps"><span>01 <b>Freeze</b> requirements</span><span>02 <b>Compare</b> evidence</span><span>03 <b>Record</b> outcome</span></div></div>}</aside></div>
        {result?.delivery_history && result.delivery_history.length > 0 && <details className="task-history"><summary>Previous rejected deliveries ({result.delivery_history.length})</summary>{result.delivery_history.map((attempt, index) => <div key={index}><strong>Attempt {index + 1}</strong><p>{attempt.delivery}</p><small>{attempt.evaluation && typeof attempt.evaluation === "object" && "reason" in attempt.evaluation ? String((attempt.evaluation as { reason?: string }).reason || "") : "Review unavailable"}</small></div>)}</details>}
      </section>
      <section className="why"><div><span className="kicker">WHY TASKROUTE</span><h2>Make agent choice<br/><em>an auditable action.</em></h2></div><p>TaskRoute leaves agent execution off-chain, but moves the decision that affects authorization and reputation into a consensus-backed contract. Every route carries its input fingerprint, candidate evidence, structured scores and reason.</p><div className="why-points"><span><Check size={14}/> Independent validator agreement</span><span><Check size={14}/> Fail-closed NO_MATCH result</span><span><Check size={14}/> Delivery review ready</span></div></section>
    </main>
    <footer><span>TaskRoute · GenLayer-native agent routing</span><span>Chain 61997 · {configured ? CONTRACT : "Preview contract not configured"}</span></footer>
  </div>;
}
