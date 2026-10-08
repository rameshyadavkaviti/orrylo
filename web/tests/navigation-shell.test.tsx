import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppShell } from "../components/app-shell";
import { NAV_ITEMS, UTILITY_NAV_ITEMS } from "../lib/navigation";

test("public shell renders primary product navigation and secondary utilities", () => {
  const html = renderToStaticMarkup(
    <AppShell>
      <div>content</div>
    </AppShell>,
  );

  for (const item of NAV_ITEMS) {
    assert.match(html, new RegExp(item.label.replace("&", "&amp;")));
    assert.ok(html.includes('href="' + item.href + '"'));
  }

  for (const item of UTILITY_NAV_ITEMS) {
    assert.match(html, new RegExp(item.label));
  }

  assert.match(html, /Early prototype/i);
  assert.match(html, /Connect Wallet/i);
  assert.doesNotMatch(html, /Runtime status/i);
  assert.doesNotMatch(html, /Contract Interface v1/i);
  assert.doesNotMatch(html, /Safety boundary/i);
});
