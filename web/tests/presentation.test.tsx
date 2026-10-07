import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateTokenPage } from "../app/create-token/page";
import { DashboardPage } from "../app/page";
import { ProductsPage } from "../app/products/page";

test("dashboard labels demo state explicitly", () => {
  const html = renderToStaticMarkup(<DashboardPage />);

  assert.match(html, /Demo data only/i);
  assert.match(html, /No live balance read/i);
  assert.match(html, /Not issued/i);
});

test("create-token screen discloses unavailable chain capabilities", () => {
  const html = renderToStaticMarkup(<CreateTokenPage />);

  assert.match(html, /Shared Issuer/i);
  assert.match(html, /Dedicated Issuer/i);
  assert.match(html, /Candidate only/i);
  assert.match(html, /Not yet available/i);
  assert.match(html, /No chain submission/i);
});

test("products remain visibly unavailable", () => {
  const html = renderToStaticMarkup(<ProductsPage />);

  assert.match(html, /Domain Link/i);
  assert.match(html, /Metadata Setup/i);
  assert.match(html, /Dedicated Issuer/i);
  assert.match(html, /Custom Service/i);
  assert.match(html, /Coming later/i);
  assert.match(html, /Unavailable/i);
});
