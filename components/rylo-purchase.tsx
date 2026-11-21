"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, Wallet, X } from "lucide-react";

const MAX = 10000;
const INITIAL_TRANCHE = "3,517,680.9993500";
const ISSUER = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";
const PRICE = 0.1;

type Quote = {
  available: boolean;
  quantity: number;
  referenceXlm: string;
  quotedXlm: string | null;
  checkedAt: string;
  reason: string | null;
};
type Inventory = {
  verified: boolean;
  amountAtOrBelowLimit: string;
  bestAskXlm: string | null;
  checkedAt: string;
  limitedToTop200Levels: boolean;
};
type Prepared = { xdr: string; quotedXlm: string; maximumXlm: string };
type TxResponse = { tx_hash?: string; result?: unknown };

export default function RyloPurchase({ variant = "primary" }: { variant?: "primary" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(100);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const requestNumber = useRef(0);
  const dialogTitleId = useId();
  const sliderId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const refreshQuote = useCallback(async (amount: number) => {
    const current = ++requestNumber.current;
    setQuoteLoading(true);
    setQuote(null);
    try {
      const response = await fetch("/api/rylo/quote?quantity=" + amount, { cache: "no-store" });
      const data = (await response.json()) as Quote & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to retrieve a live quote.");
      if (requestNumber.current === current) setQuote(data);
    } catch (reason) {
      if (requestNumber.current === current) {
        setQuote(null);
        setError(reason instanceof Error ? reason.message : "Unable to check liquidity.");
      }
    } finally {
      if (requestNumber.current === current) setQuoteLoading(false);
    }
  }, []);

  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const response = await fetch("/api/rylo/orderbook", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const result = await response.json() as Inventory;
      if (!result.verified) throw new Error("Unavailable");
      setInventory(result);
    } catch {
      setInventory(null);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshInventory();
  }, [open, refreshInventory]);

  useEffect(() => {
    if (!open) return;
    setError("");
    const timeout = setTimeout(() => { void refreshQuote(quantity); }, 350);
    return () => { clearTimeout(timeout); requestNumber.current++; };
  }, [open, quantity, refreshQuote]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !working) setOpen(false);
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]") || []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [open, working]);

  useEffect(() => { if (!open) buttonRef.current?.focus(); }, [open]);

  function setAmount(amount: number) {
    if (!Number.isFinite(amount)) return;
    setQuantity(Math.min(MAX, Math.max(1, Math.round(amount))));
    setError("");
    setTxHash("");
    setConfirmed(false);
  }

  async function connect() {
    setWorking(true);
    setError("");
    setStep("Opening Albedo to connect your wallet…");
    try {
      const { default: albedo } = await import("@albedo-link/intent");
      const response = await albedo.publicKey({ require_existing: true });
      if (!response.pubkey || !/^G[A-Z2-7]{55}$/.test(response.pubkey)) throw new Error("No valid Stellar account selected.");
      setPubkey(response.pubkey);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Albedo connection was cancelled.");
    } finally { setWorking(false); setStep(""); }
  }

  async function buy() {
    if (!pubkey || !quote?.available || quote.quantity !== quantity || quoteLoading || working) return;
    setWorking(true); setError(""); setStep("Checking trustline and current market liquidity…");
    setTxHash(""); setConfirmed(false);
    try {
      const { default: albedo } = await import("@albedo-link/intent");
      // A trustline is required for classic Stellar assets. The user approves it separately.
      const accountResponse = await fetch("/api/rylo/wallet?pubkey=" + encodeURIComponent(pubkey), { cache: "no-store" });
      const walletInfo = (await accountResponse.json()) as { hasTrustline?: boolean; error?: string };
      if (!accountResponse.ok) throw new Error(walletInfo.error || "Unable to verify your Stellar wallet.");
      if (!walletInfo.hasTrustline) {
        setStep("Confirm the RYLO trustline in Albedo (requires Stellar reserves)…");
        await albedo.trust({ asset_code: "RYLO", asset_issuer: ISSUER, pubkey, network: "public", submit: true });
      }
      setStep("Preparing a live order at no more than 0.1 XLM per RYLO…");
      const prepResponse = await fetch("/api/rylo/prepare", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey, quantity })
      });
      const prepared = (await prepResponse.json()) as Prepared & { error?: string };
      if (!prepResponse.ok) throw new Error(prepared.error || "Unable to prepare a valid purchase.");
      setStep("Review and approve the Stellar purchase in Albedo…");
      const transaction = await albedo.tx({
        xdr: prepared.xdr, pubkey, network: "public", submit: true,
        description: "Buy " + quantity + " RYLO, spending at most " + prepared.maximumXlm + " XLM."
      }) as TxResponse;
      const hash = transaction.tx_hash;
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) throw new Error("Transaction submitted, but no verifiable hash was returned. Check your wallet before retrying.");
      setTxHash(hash);
      setStep("Verifying confirmation on Stellar…");
      const verification = await fetch("/api/rylo/confirm?hash=" + encodeURIComponent(hash), { cache: "no-store" });
      const result = (await verification.json()) as { confirmed?: boolean };
      if (verification.ok && result.confirmed) { setConfirmed(true); void refreshInventory(); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Purchase was not completed.");
    } finally { setWorking(false); setStep(""); }
  }

  return <>
    <button ref={buttonRef} type="button" onClick={() => { setError(""); setOpen(true); }}
      className={variant === "primary" ? "button-primary" : "button-outline"}>
      Buy RYLO <ArrowUpRight size={17} />
    </button>

    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-md"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !working) setOpen(false); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}
        className="relative my-auto w-full max-w-[530px] rounded-[26px] border border-white/15 bg-[#15181e] p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:p-8">
        <button ref={closeRef} type="button" disabled={working} aria-label="Close purchase dialog" onClick={() => setOpen(false)}
          className="absolute right-4 top-4 rounded-full border border-white/10 p-2 text-[#c8b9bf] transition hover:text-white disabled:opacity-40">
          <X size={19}/>
        </button>
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-crimson/20 bg-[#1b2026]">
            <Image src="/logo-red.svg" alt="" width={54} height={54} className="h-14 w-14 object-contain"/>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.19em] text-[#c592a0]">Stellar mainnet · RYLO V2</p>
            <h2 id={dialogTitleId} className="mt-1 text-2xl font-semibold tracking-tight">Buy RYLO</h2>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0d1015] p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <label htmlFor={sliderId} className="text-xs font-semibold text-[#acacb5]">Select token amount</label>
            <div className="flex items-end gap-2"><input type="number" min={1} max={MAX} step={1} disabled={working}
                aria-label="RYLO quantity" value={quantity} onChange={(e) => setAmount(Number(e.target.value))}
                className="w-[110px] rounded-lg border border-white/15 bg-[#1b2028] px-2 py-2 text-right text-lg font-semibold outline-none focus:border-crimson"/>
              <span className="mb-2 text-xs text-[#aeb0b9]">RYLO</span></div>
          </div>
          <input id={sliderId} type="range" min={1} max={MAX} step={1} value={quantity}
            disabled={working} onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full cursor-pointer accent-[#B76B7C] disabled:cursor-not-allowed"/>
          <div className="mt-1 flex justify-between text-[11px] text-[#8b929b]"><span>1 RYLO</span><span>{MAX.toLocaleString("en-US")} RYLO</span></div>
          <div className="mt-4 flex flex-wrap gap-2">{[100,500,1000,5000].map((n) =>
            <button key={n} type="button" disabled={working} onClick={() => setAmount(n)}
              className={"rounded-full border px-3 py-1.5 text-xs transition " + (quantity===n?"border-crimson/70 bg-crimson/20 text-white":"border-white/10 text-[#9faab1] hover:border-crimson/40")}>{n.toLocaleString("en-US")}</button>)}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 p-4">
            <div className="text-[11px] text-[#9faab2]">Reference unit price</div>
            <div className="mt-2 text-xl font-semibold">0.1 <span className="text-xs text-[#9faab2]">XLM / RYLO</span></div>
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <div className="text-[11px] text-[#9faab2]">Maximum spend (excl. fees)</div>
            <div className="mt-2 text-xl font-semibold">{(quantity * PRICE).toFixed(1)} <span className="text-xs text-[#9faab2]">XLM</span></div>
          </div>
        </div>
        <div className="mt-3 flex justify-between gap-3 rounded-xl border border-white/10 px-4 py-3 text-xs">
          <span className="text-[#a9b4b7]">Live market quote</span>
          <span className={"text-right font-semibold " + (quote?.available ? "text-[#d3e8dc]" : "text-[#dbb8c1]")}>
            {quoteLoading ? "Checking…" : quote?.quotedXlm ? quote.quotedXlm + " XLM" : "Unavailable"}
          </span>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0d1015] p-4" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#ebd0d5]">Currently listed at ≤ 0.1 XLM</span>
            <span className="text-base font-semibold text-white">
              {inventoryLoading ? "Checking…" : inventory ? inventory.amountAtOrBelowLimit + " RYLO" : "Not verifiable"}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#aeb1b8]">
            Live direct RYLO/XLM sell orders, not the total issuance or guaranteed sale inventory.
            {inventory?.limitedToTop200Levels ? " Shows only the top 200 order-book price levels." : ""}
            {inventory ? " Checked " + new Date(inventory.checkedAt).toLocaleTimeString() + "." : ""}
            Orders can change or be filled at any time.
          </p>
          <button type="button" disabled={inventoryLoading} onClick={() => void refreshInventory()}
            className="mt-2 text-[11px] font-semibold text-[#d7a5b4] underline underline-offset-4 disabled:opacity-50">Refresh market depth</button>
        </div>
        <div className="mt-3 rounded-2xl border border-crimson/20 bg-crimson/[.035] p-4">
          <div className="flex justify-between gap-2">
            <span className="text-xs font-semibold text-[#ebd0d5]">Planned initial release</span>
            <span className="text-sm font-semibold">{INITIAL_TRANCHE} RYLO</span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#aeb1b8]">This is the tokenomics month-0 release cap, <strong>not verified tokens offered for sale</strong>. Actual executable inventory depends on Stellar liquidity. Transaction fees and potential trustline reserves are separate.</p>
        </div>
        <p className="mt-3 break-all text-[10px] leading-5 text-[#8b969e]">Issuer (RYLO V2): <a href={"https://stellar.expert/explorer/public/account/" + ISSUER} target="_blank" rel="noopener noreferrer" className="text-[#d3a1af] underline underline-offset-2">{ISSUER.slice(0,14)}…{ISSUER.slice(-9)}</a></p>
        {quote?.reason && <p className="mt-3 text-xs leading-5 text-[#dec0c7]" role="status">{quote.reason}</p>}
        {error && <p className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/5 p-3 text-xs leading-6 text-[#f1cbd5]" role="alert">{error}</p>}
        {step && <p className="mt-3 flex items-center gap-2 text-xs text-[#d7c4ca]" role="status"><LoaderCircle size={15} className="animate-spin"/>{step}</p>}
        {txHash && <div className="mt-4 rounded-xl border border-white/15 bg-white/[.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">{confirmed ? <CheckCircle2 className="text-emerald-300" size={18}/> : <LoaderCircle className="text-[#e5c2cc]" size={18}/>}
            {confirmed ? "Purchase confirmed on Stellar" : "Submitted — confirmation not verified"}
          </div>
          <a className="mt-2 inline-flex items-center gap-1 text-xs text-[#d6b1bd] underline" href={"https://stellar.expert/explorer/public/tx/" + txHash} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={12}/></a>
        </div>}
        <div className="mt-5 flex flex-col gap-3">
          {!pubkey ? <button type="button" disabled={working} onClick={() => void connect()} className="button-primary w-full justify-center disabled:opacity-50"><Wallet size={18}/> Connect Albedo</button> :
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-[#b9bfc5]"><span className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#c794a2]"/>Wallet: {pubkey.slice(0,7)}…{pubkey.slice(-7)}</span>
                <button type="button" disabled={working} onClick={() => {setPubkey(null);setError("");}} className="underline underline-offset-4 hover:text-white">Change</button></div>
              <button type="button" disabled={working || quoteLoading || !quote?.available || quote.quantity!==quantity || Boolean(txHash)}
                onClick={() => void buy()}
                className="button-primary w-full justify-center disabled:cursor-not-allowed disabled:bg-[#43383e] disabled:text-[#aeb0b5]">
                {working ? <LoaderCircle size={17} className="animate-spin"/> : <ArrowRight size={17}/>} Confirm purchase with Albedo
              </button>
            </>}
        </div>
        <p className="mt-4 text-center text-[11px] leading-5 text-[#8d999d]">Albedo signs in your wallet. ORRYLO never asks for secret keys or holds your funds. If no live quote meets your price cap, no purchase will be submitted.</p>
      </section>
    </div>, document.body)}
  </>;
}
