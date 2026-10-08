import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateTokenPage } from "../app/create-token/page";
import { HomePage } from "../app/page";
import { ProductsPage } from "../app/products/page";
import { RyloPage } from "../app/rylo/page";

test("homepage presents Orrylo as a public product prototype", () => {
  const html = renderToStaticMarkup(<HomePage />);

  assert.match(html, /Create your Stellar token in minutes/i);
  assert.match(html, />Create Token</i);
  assert.match(html, />Connect Wallet</i);
  assert.match(html, /Explore RYLO/i);
  assert.match(html, /Products &amp; Services/i);
  assert.match(html, /Token issuance.*not enabled/i);
  assert.doesNotMatch(html, /Runtime status/i);
  assert.doesNotMatch(html, /Contract Interface/i);
});

test("create-token experience guides identity, metadata, and safe preview", () => {
  const html = renderToStaticMarkup(<CreateTokenPage />);

  assert.match(html, /Token identity/i);
  assert.match(html, /Metadata/i);
  assert.match(html, /Preview/i);
  assert.match(html, /Shared Issuer/i);
  assert.match(html, /Dedicated Issuer/i);
  assert.match(html, /Coming soon/i);
  assert.match(html, /No on-chain submission/i);
  assert.match(html, /Draft only/i);
  assert.match(html, /Launch token.*Coming soon/i);
});

test("RYLO page presents approved membership, credit, and reward policy", () => {
  const html = renderToStaticMarkup(<RyloPage />);

  assert.match(html, /first successful token creation/i);
  assert.match(html, /50 RYLO-equivalent/i);
  assert.match(html, /150 RYLO/i);
  assert.match(html, /60 days/i);
  assert.match(html, /1 RYLO = 0.1 XLM/i);
  assert.match(html, /not intrinsic value/i);
  assert.match(html, /Reward execution not live/i);
});

test("products distinguish available prototype work from future services", () => {
  const html = renderToStaticMarkup(<ProductsPage />);

  assert.match(html, /Token Draft/i);
  assert.match(html, /Prototype available/i);
  assert.match(html, /Metadata &amp; Domain/i);
  assert.match(html, /Dedicated Issuer/i);
  assert.match(html, /Custom Stellar Services/i);
  assert.match(html, /Coming soon/i);
  assert.match(html, /does not simulate/i);
});
