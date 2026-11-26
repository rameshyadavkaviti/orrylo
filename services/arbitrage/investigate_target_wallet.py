#!/usr/bin/env python3
"""Read-only Stellar Horizon account history exporter. Standard library only.

Output ZIP contains analysis.json and raw/{account.json,transactions.jsonl,
operations.jsonl,trades.jsonl,offers.jsonl,effects.jsonl}.
Historical open/closed offer state cannot be reconstructed from /offers alone.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HORIZON = "https://horizon.stellar.org"
DEFAULT_ACCOUNT = "GCQN6GZ4ATLRCYPBQB5ZBZEF5WUWYKO76CB7SOSSQXTCDBZPMVOGM7DT"
COLLECTIONS = ("transactions", "operations", "trades", "offers", "effects")
RETRY_STATUS = {429, 500, 502, 503, 504}


def get_json(url: str, retries: int = 5) -> dict:
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "orrylo-readonly-wallet-research/1.0"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code not in RETRY_STATUS or attempt == retries - 1:
                raise
            delay = min(30, 2 ** attempt)
            try:
                delay = max(delay, min(30, int(exc.headers.get("Retry-After", "0"))))
            except (TypeError, ValueError):
                pass
            time.sleep(delay)
        except (TimeoutError, urllib.error.URLError):
            if attempt == retries - 1:
                raise
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError("Unreachable retry state")


def utc_hour(value) -> str | None:
    if value is None:
        return None
    try:
        if isinstance(value, (float, int)) or str(value).isdigit():
            stamp = dt.datetime.fromtimestamp(float(value), dt.timezone.utc)
        else:
            stamp = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return stamp.astimezone(dt.timezone.utc).strftime("%H")
    except (ValueError, OSError, OverflowError):
        return None


def asset_key(record: dict, prefix: str) -> str:
    kind = record.get(prefix + "_asset_type")
    if kind == "native":
        return "XLM"
    code = record.get(prefix + "_asset_code")
    issuer = record.get(prefix + "_asset_issuer")
    return f"{code}:{issuer}" if code and issuer else "UNKNOWN"


def summarize_record(kind: str, record: dict, summary: dict) -> None:
    summary["counts"][kind] += 1
    if kind == "transactions":
        stamp = record.get("created_at")
        hour = utc_hour(stamp)
        if hour is not None:
            summary["transaction_hour_utc"][hour] += 1
    elif kind == "operations":
        op_type = record.get("type", "unknown")
        summary["operation_types"][op_type] += 1
        if op_type in {"manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer"}:
            qty = record.get("buy_amount") if op_type == "manage_buy_offer" else record.get("amount")
            if qty is not None:
                try:
                    if float(qty) == 0:
                        summary["offer_cancel_instructions"] += 1
                    else:
                        summary["offer_create_or_update_instructions"] += 1
                except (TypeError, ValueError):
                    pass
    elif kind == "trades":
        pair = sorted((asset_key(record, "base"), asset_key(record, "counter")))
        summary["traded_pairs"]["/".join(pair)] += 1
        stamp = record.get("ledger_close_time") or record.get("created_at")
        hour = utc_hour(stamp)
        if hour is not None:
            summary["trade_hour_utc"][hour] += 1


def collect(account: str, target: pathlib.Path, max_records: int, page_limit: int) -> dict:
    account_url = f"{HORIZON}/accounts/{account}"
    report = {
        "account": account,
        "network": "Stellar Mainnet",
        "source": HORIZON,
        "extracted_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "counts": collections.Counter(),
        "operation_types": collections.Counter(),
        "traded_pairs": collections.Counter(),
        "transaction_hour_utc": collections.Counter(),
        "trade_hour_utc": collections.Counter(),
        "offer_cancel_instructions": 0,
        "offer_create_or_update_instructions": 0,
        "coverage": {},
        "estimated_trading_pnl_xlm": None,
        "limitations": [
            "Transactions and trades do not alone establish realized profit or cost basis.",
            "The offers endpoint is a snapshot of currently open offers, not a full historical offer timeline.",
            "Offer operations are submitted instructions; execution/fill requires separate transaction and effect reconciliation.",
            "Collection truncation and Horizon retention may prevent exhaustive historical analysis.",
            "This exporter never submits transactions or reads private keys.",
        ],
    }
    with tempfile.TemporaryDirectory(prefix="stellar_account_") as td:
        root = pathlib.Path(td)
        raw = root / "raw"
        raw.mkdir()
        account_data = get_json(account_url)
        (raw / "account.json").write_text(json.dumps(account_data, indent=2, ensure_ascii=False), encoding="utf-8")
        report["current_balances"] = [
            {"asset": "XLM" if b.get("asset_type") == "native" else b.get("asset_code", "UNKNOWN") + ":" + b.get("asset_issuer", ""), "balance": b.get("balance")}
            for b in account_data.get("balances", [])
        ]
        for kind in COLLECTIONS:
            fetched, pages, cursor = 0, 0, None
            first_token, last_token = None, None
            with (raw / (kind + ".jsonl")).open("w", encoding="utf-8") as file:
                while fetched < max_records and pages < page_limit:
                    query = {"limit": str(min(200, max_records - fetched)), "order": "desc"}
                    if cursor:
                        query["cursor"] = cursor
                    url = f"{account_url}/{kind}?{urllib.parse.urlencode(query)}"
                    data = get_json(url)
                    items = data.get("_embedded", {}).get("records", [])
                    if not isinstance(items, list):
                        raise RuntimeError(f"Malformed Horizon collection: {kind}")
                    if not items:
                        break
                    for record in items:
                        file.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                        summarize_record(kind, record, report)
                    fetched += len(items)
                    pages += 1
                    first_token = first_token or items[0].get("paging_token")
                    last_token = items[-1].get("paging_token")
                    if not last_token or last_token == cursor:
                        break
                    cursor = last_token
                    if len(items) < int(query["limit"]):
                        break
            report["coverage"][kind] = {
                "downloaded_records": fetched,
                "pages": pages,
                "first_paging_token": first_token,
                "last_paging_token": last_token,
                "potentially_truncated": fetched >= max_records or pages >= page_limit,
            }
        for key in ("counts", "operation_types", "traded_pairs", "transaction_hour_utc", "trade_hour_utc"):
            report[key] = dict(report[key])
        (root / "analysis.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=7) as archive:
            for file in sorted(root.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(root))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only Stellar account public history to ZIP")
    parser.add_argument("--account", default=DEFAULT_ACCOUNT)
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path.home() / "Documents/orrylo/target_wallet_analysis.zip")
    parser.add_argument("--max-records", type=int, default=10000, help="maximum records per collection")
    parser.add_argument("--max-pages", type=int, default=50)
    args = parser.parse_args()
    if not re.fullmatch(r"G[A-Z2-7]{55}", args.account):
        parser.error("Invalid public Stellar account address")
    if not 1 <= args.max_records <= 100000 or not 1 <= args.max_pages <= 500:
        parser.error("max-records must be 1..100000; max-pages 1..500")
    try:
        result = collect(args.account, args.output.expanduser().resolve(), args.max_records, args.max_pages)
    except Exception as exc:
        raise SystemExit(f"Extraction failed (no result claimed): {type(exc).__name__}: {exc}") from exc
    print("ZIP:", args.output.expanduser().resolve())
    print("Extracted record counts:", json.dumps(result["counts"], sort_keys=True))
    print("Profitability: NOT INFERRED")


if __name__ == "__main__":
    main()
