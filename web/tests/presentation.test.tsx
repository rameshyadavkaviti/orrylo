import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateTokenPage } from "../app/create-token/page";
import { HomePage } from "../app/page";
import { ProductsPage } from "../app/products/page";
import { RyloPage } from "../app/rylo/page";

test("homepage makes anonymous token building the dominant product journey", () => {
  const html = renderToStaticMarkup(<HomePage />);

  assert.match(html, /Create your Stellar token in minutes/i);
  assert.match(html, />Create Token</i);
  assert.match(html, />Connect Wallet</i);
  assert.match(html, /no wallet connection required/i);
  assert.match(html, /use the token builder anonymously/i);
  assert.match(html, /Products &amp; Services/i);
  assert.match(html, /Explore RYLO/i);
  assert.match(html, /On-chain token issuance is not enabled/i);
});

test("create-token experience offers a meaningful anonymous live builder", () => {
  const html = renderToStaticMarkup(<CreateTokenPage />);

  assert.match(html, /Build a Stellar token before you connect anything/i);
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
  assert.match(html, /Ready to manage/i);
  assert.match(html, /Save &amp; manage project/i);
  assert.match(html, /does not create a Stellar asset/i);
  assert.match(html, /On-chain issuance remains a separate later step/i);
  assert.doesNotMatch(html, /Draft only/i);
  assert.doesNotMatch(html, /No on-chain submission/i);
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
