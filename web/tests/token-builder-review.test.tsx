import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateSharedTokenForm } from "../components/create-shared-token-form";
import {
  matchesCurrentBuilderReview,
  prepareTokenBuilderReview,
} from "../lib/projects/token-builder-review";
import {
  prepareManagedProjectSave,
  withWalletContinuityAssertion,
} from "../lib/projects/pending-managed-project";
import { parseCreateManagedProjectRequest } from "../lib/projects/managed-project-api";

const DRAFT = {
  code: " nova ",
  displayName: " Nova Token ",
  description: " A sample token ",
};

test("initial supply review is exact, normalized, and independent from a lifetime cap", () => {
  const checked = prepareTokenBuilderReview(DRAFT, "0002.3400000", "logo.png");
  assert.equal(checked.valid, true);
  if (!checked.valid) return;
  assert.deepEqual(checked.review, {
    assetCode: "NOVA",
    displayName: "Nova Token",
    description: "A sample token",
    initialSupply: "2.34",
    initialSupplyStroops: "23400000",
    logoFileName: "logo.png",
  });
  assert.equal(
    matchesCurrentBuilderReview(checked.review, {code:"NOVA",displayName:"Nova Token",description:"A sample token"}, "2.3400000", "logo.png"),
    true,
  );
  assert.equal(matchesCurrentBuilderReview(checked.review, DRAFT, "2.3400001", "logo.png"), false);
  assert.equal(matchesCurrentBuilderReview(checked.review, {...DRAFT, code:"OTHER"}, "2.34", "logo.png"), false);
  assert.equal(matchesCurrentBuilderReview(checked.review, DRAFT, "2.34", "new.png"), false);
  assert.equal(matchesCurrentBuilderReview(checked.review, DRAFT, "2.34", null), false);
});

test("invalid code, name, or amount cannot pass final review", () => {
  for (const [draft, amount] of [
    [{...DRAFT, code:"invalid!"}, "100"],
    [{...DRAFT, displayName:" "}, "100"],
    [DRAFT, "0"],
    [DRAFT, "1.00000001"],
    [DRAFT, "922337203685.4775808"],
    [DRAFT, "1e6"],
  ] as const) {
    assert.equal(prepareTokenBuilderReview(draft, amount, null).valid, false);
  }
});

test("project save deliberately excludes browser-reviewed supply and logo", () => {
  const approved = prepareTokenBuilderReview(DRAFT, "100.25", "local.png");
  assert.equal(approved.valid, true);
  const saved = prepareManagedProjectSave(DRAFT, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(Object.keys(saved.pending.request).sort(), [
    "code", "description", "displayName", "idempotencyKey",
  ]);
  const walletBound = withWalletContinuityAssertion(saved.pending, "G" + "A".repeat(55));
  assert.equal(walletBound.request.authenticatedWalletAssertion, "G" + "A".repeat(55));
  assert.equal("initialSupply" in walletBound.request, false);
  assert.equal("logo" in walletBound.request, false);
  assert.equal(parseCreateManagedProjectRequest({
    ...saved.pending.request, initialSupply: "100.25",
  }), null);
});

test("builder marks a supply as browser-only and gates saving behind review", () => {
  const html = renderToStaticMarkup(<CreateSharedTokenForm />);
  assert.match(html, /Initial supply \(token units\)/);
  assert.match(html, /Review configuration/);
  assert.match(html, /Browser draft only/);
  assert.match(html, /Save Project Profile only/);
  assert.match(html, /not token supply/);
  assert.match(html, /fixed lifetime supply/i);
  assert.match(html, /Shared Issuer/);
  assert.match(html, /Orrylo-operated/);
  assert.match(html, /Not selected/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Confirm issuance|Token issued|Fixed Supply mode/);
});
