"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, Wallet, X } from "lucide-react";

const TECHNICAL_MAX = 10000;
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
type AlbedoClient = (typeof import("@albedo-link/intent"))["default"];
type ReadyPurchase = Prepared & { quantity: number; pubkey: string; createdAt: number };

export default function RyloPurchase({ variant = "primary" }: { variant?: "primary" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(100);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [albedoReady, setAlbedoReady] = useState(false);
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [prepared, setPrepared] = useState<ReadyPurchase | null>(null);
  const albedoRef = useRef<AlbedoClient | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const listedAmount = inventory?.verified
    ? Number(inventory.amountAtOrBelowLimit.replace(/,/g, ""))
    : 0;
  const maxQuantity = Number.isFinite(listedAmount)
    ? Math.max(0, Math.min(TECHNICAL_MAX, Math.floor(listedAmount)))
    : 0;
  const canSelectAmount = !inventoryLoading && Boolean(inventory?.verified) && maxQuantity >= 1;
  const selectedQuantity = maxQuantity > 0 ? Math.min(quantity, maxQuantity) : 1;
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
      const amount = Number(result.amountAtOrBelowLimit.replace(/,/g, ""));
      const limit = Number.isFinite(amount) ? Math.max(0, Math.min(TECHNICAL_MAX, Math.floor(amount))) : 0;
      setQuantity((previous) => Math.max(1, Math.min(previous, Math.max(limit, 1))));
      setPrepared(null);
    } catch {
      setInventory(null);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setInventory(null);
    void refreshInventory();
  }, [open, refreshInventory]);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (!canSelectAmount || quantity > maxQuantity) {
      setQuote(null);
      return;
    }
    const timeout = setTimeout(() => { void refreshQuote(quantity); }, 350);
    return () => { clearTimeout(timeout); requestNumber.current++; };
  }, [open, quantity, canSelectAmount, maxQuantity, refreshQuote]);

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

  useEffect(() => {
    if (!open) {
      setPrepared(null);
      return;
    }
    let active = true;
    void import("@albedo-link/intent").then((module) => {
      if (active) { albedoRef.current = module.default; setAlbedoReady(true); }
    }).catch(() => { if (active) setError("Unable to load Albedo. Try reloading the page."); });
    return () => { active = false; };
  }, [open]);

  const verifyTrustline = useCallback(async (wallet: string) => {
    setHasTrustline(null);
    try {
      const response = await fetch("/api/rylo/wallet?pubkey=" + encodeURIComponent(wallet), { cache: "no-store" });
      const result = await response.json() as { hasTrustline?: boolean; error?: string };
      if (!response.ok || typeof result.hasTrustline !== "boolean") {
        throw new Error(result.error || "Unable to check RYLO trustline.");
      }
      setHasTrustline(result.hasTrustline);
    } catch (error) {
      setHasTrustline(null);
      setError(error instanceof Error ? error.message : "Unable to check RYLO trustline.");
    }
  }, []);

  useEffect(() => {
    if (open && pubkey) void verifyTrustline(pubkey);
  }, [open, pubkey, verifyTrustline]);

  function setAmount(amount: number) {
    if (!Number.isFinite(amount)) return;
    if (!canSelectAmount) return;
    setQuantity(Math.min(maxQuantity, Math.max(1, Math.round(amount))));
    setError("");
    setTxHash("");
    setConfirmed(false);
    setPrepared(null);
  }

  async function connect() {
    const albedo = albedoRef.current;
    if (!albedo) { setError("Albedo is still loading."); return; }
    setWorking(true);
    setError("");
    setStep("Opening Albedo to connect your wallet…");
    try {
      // Call the wallet intent directly from the user gesture so popup blockers do not interfere.
      const intent = albedo.publicKey({ require_existing: true });
      const response = await intent;
      if (!response.pubkey || !/^G[A-Z2-7]{55}$/.test(response.pubkey)) {
        throw new Error("No valid Stellar account selected.");
      }
      setPubkey(response.pubkey);
      setPrepared(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Albedo connection was cancelled.");
    } finally { setWorking(false); setStep(""); }
  }

  async function addTrustline() {
    const albedo = albedoRef.current;
    if (!albedo || !pubkey || working) return;
    setWorking(true);
    setError("");
    setStep("Review and approve the RYLO trustline in Albedo…");
    try {
      const intent = albedo.trust({ asset_code: "RYLO", asset_issuer: ISSUER, pubkey, network: "public", submit: true });
      await intent;
      setStep("Checking new trustline on Stellar…");
      await verifyTrustline(pubkey);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trustline was not approved.");
    } finally { setWorking(false); setStep(""); }
  }

  async function prepare() {
    if (!pubkey || !hasTrustline || !canSelectAmount || quantity > maxQuantity ||
      !quote?.available || quote.quantity !== quantity || quoteLoading || working) return;
    setWorking(true);
    setError("");
    setPrepared(null);
    setStep("Checking market liquidity and preparing a price-limited transaction…");
    try {
      const response = await fetch("/api/rylo/prepare", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey, quantity })
      });
      const result = await response.json() as Prepared & { error?: string };
      if (!response.ok || !result.xdr) throw new Error(result.error || "Unable to prepare this purchase.");
      setPrepared({ ...result, quantity, pubkey, createdAt: Date.now() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to prepare this purchase.");
    } finally { setWorking(false); setStep(""); }
  }

  async function signAndSubmit() {
    const albedo = albedoRef.current;
    if (!albedo || !prepared || !pubkey || !canSelectAmount || quantity > maxQuantity || working || confirmed || txHash) return;
    if (prepared.quantity !== quantity || prepared.pubkey !== pubkey || Date.now() - prepared.createdAt >= 100000) {
      setPrepared(null);
      setError("The order has expired. Prepare a fresh market quote.");
      return;
    }
    setWorking(true);
    setError("");
    setStep("Review and approve your purchase in Albedo…");
    try {
      // This opens immediately on a direct user click; no asynchronous API call precedes it.
      const intent = albedo.tx({
        xdr: prepared.xdr, pubkey, network: "public", submit: true,
        description: "Receive " + quantity + " RYLO; spend no more than " + prepared.maximumXlm + " XLM, excluding network fees."
      });
      const transaction = await intent as TxResponse;
      const hash = transaction.tx_hash;
      if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
        throw new Error("Transaction status is uncertain. Inspect your Stellar wallet before retrying.");
      }
      setTxHash(hash);
      setPrepared(null);
      setStep("Checking confirmation on Stellar…");
      const verification = await fetch("/api/rylo/confirm?hash=" + encodeURIComponent(hash), { cache: "no-store" });
      const result = await verification.json() as { confirmed?: boolean };
      if (verification.ok && result.confirmed) {
        setConfirmed(true);
        void refreshInventory();
      }
    } catch (reason) {
      setPrepared(null);
      setError(reason instanceof Error ? reason.message : "Purchase could not be confirmed.");
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
            <div className="flex items-end gap-2"><input type="number" min={1} max={Math.max(1, maxQuantity)} step={1} disabled={working || !canSelectAmount}
                aria-label="RYLO quantity" value={selectedQuantity} onChange={(e) => setAmount(Number(e.target.value))}
                className="w-[110px] rounded-lg border border-white/15 bg-[#1b2028] px-2 py-2 text-right text-lg font-semibold outline-none focus:border-crimson"/>
              <span className="mb-2 text-xs text-[#aeb0b9]">RYLO</span></div>
          </div>
          <input id={sliderId} type="range" min={1} max={Math.max(1, maxQuantity)} step={1} value={selectedQuantity}
            disabled={working || !canSelectAmount} onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full cursor-pointer accent-[#B76B7C] disabled:cursor-not-allowed"/>
          <div className="mt-1 flex justify-between text-[11px] text-[#8b929b]"><span>1 RYLO</span><span>{canSelectAmount ? maxQuantity.toLocaleString("en-US") + " RYLO" : "Checking availability…"}</span></div>
          <div className="mt-4 flex flex-wrap gap-2">{[100,500,1000,5000].filter((n) => n <= maxQuantity).map((n) =>
            <button key={n} type="button" disabled={working || !canSelectAmount} onClick={() => setAmount(n)}
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
            Orders can change or be filled at any time. The selector follows currently listed quantities.
          </p>
          <button type="button" disabled={inventoryLoading} onClick={() => void refreshInventory()}
            className="mt-2 text-[11px] font-semibold text-[#d7a5b4] underline underline-offset-4 disabled:opacity-50">Refresh market depth</button>
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
          {!pubkey ? <button type="button" disabled={working || !albedoReady} onClick={() => void connect()}
              className="button-primary w-full justify-center disabled:opacity-50">
              <Wallet size={18}/>{albedoReady ? "Connect Albedo" : "Loading Albedo…"}
            </button> :
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-[#b9bfc5]">
                <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#c794a2]"/>
                  Wallet: {pubkey.slice(0,7)}…{pubkey.slice(-7)}
                </span>
                <button type="button" disabled={working} onClick={() => {
                  setPubkey(null); setHasTrustline(null); setPrepared(null); setError("");
                }} className="underline underline-offset-4 hover:text-white">Change</button>
              </div>
              {hasTrustline === null ? <button type="button" disabled={working} onClick={() => void verifyTrustline(pubkey)}
                  className="button-outline w-full justify-center disabled:opacity-50">Check RYLO trustline</button> :
                !hasTrustline ? <button type="button" disabled={working || !albedoReady}
                  onClick={() => void addTrustline()}
                  className="button-primary w-full justify-center disabled:opacity-50">
                  <Wallet size={17}/> Add RYLO trustline via Albedo
                </button> :
                !prepared ? <button type="button"
                  disabled={working || !canSelectAmount || quantity > maxQuantity || quoteLoading || !quote?.available || quote.quantity !== quantity || Boolean(txHash)}
                  onClick={() => void prepare()}
                  className="button-primary w-full justify-center disabled:cursor-not-allowed disabled:bg-[#43383e] disabled:text-[#aeb0b5]">
                  <ArrowRight size={17}/> Prepare purchase
                </button> :
                <>
                  <div className="rounded-xl border border-crimson/30 bg-crimson/[.05] p-3 text-xs leading-6 text-[#e4ccd3]">
                    You will receive <strong>{prepared.quantity.toLocaleString("en-US")} RYLO</strong>.
                    Maximum payment: <strong>{prepared.maximumXlm} XLM</strong> plus a network fee.
                    A fresh market check was performed when this transaction was prepared.
                  </div>
                  <button type="button" disabled={working || !albedoReady || !canSelectAmount || quantity > maxQuantity || Boolean(txHash)}
                    onClick={() => void signAndSubmit()}
                    className="button-primary w-full justify-center disabled:opacity-50">
                    <ArrowRight size={17}/> Sign and submit with Albedo
                  </button>
                  <button type="button" disabled={working} onClick={() => void prepare()}
                    className="text-xs text-[#caa5b1] underline underline-offset-4">Refresh price and transaction</button>
                </>
              }
            </>}
        </div>
        <p className="mt-4 text-center text-[11px] leading-5 text-[#8d999d]">Albedo signs in your wallet. ORRYLO never asks for secret keys or holds your funds. If no live quote meets your price cap, no purchase will be submitted.</p>
      </section>
    </div>, document.body)}
  </>;
}
