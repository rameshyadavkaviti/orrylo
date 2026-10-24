import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateTokenPage } from "../app/create-token/page";
import { HomePage } from "../app/page";
import { ProductsPage } from "../app/products/page";
import { RyloPage } from "../app/rylo/page";

test("homepage makes anonymous token building the dominant product journey", () => {
  const html = renderToStaticMarkup(<HomePage />);

  assert.match(html, /Your idea.*Made tangible/is);
  assert.match(html, />Create your product/i);
  assert.match(html, /Wallet approval required to issue/i);
  assert.match(html, /Free to explore/i);
  assert.match(html, /Testnet only/i);
  assert.match(html, /Connect Albedo/i);
  assert.match(html, /Testnet issuance is available/i);
});

test("create-token experience offers a meaningful anonymous live builder", () => {
  const html = renderToStaticMarkup(<CreateTokenPage />);

  assert.match(html, /Create your product\./i);
  assert.match(html, /No wallet needed to explore/i);
  assert.match(html, /Token identity/i);
  assert.match(html, /Description/i);
  assert.match(html, /Logo &amp; presentation/i);
  assert.match(html, /Infrastructure/i);
  assert.match(html, /Metadata preview/i);
  assert.match(html, /Live token preview/i);
  assert.match(html, /Shared Issuer/i);
  assert.match(html, /Dedicated Issuer/i);
  assert.match(html, /Coming soon/i);
  assert.match(html, /Initial supply \(token units\)/i);
  assert.match(html, /Review configuration/i);
  assert.match(html, /Browser draft only/i);
  assert.match(html, /Create Token/i);
  assert.match(html, /owner and receiving destination/i);
  assert.match(html, /server-authoritative/i);
  assert.match(html, /authoritative durable confirmation/i);
  assert.doesNotMatch(html, /Save Project Profile only/i);
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
