import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppShell } from "../components/app-shell";
import { NAV_ITEMS } from "../lib/navigation";

test("application shell renders every approved navigation destination", () => {
  const html = renderToStaticMarkup(
    <AppShell>
      <div>content</div>
    </AppShell>,
  );

  for (const item of NAV_ITEMS) {
    assert.match(html, new RegExp(item.label.replace("&", "&amp;")));
    assert.ok(html.includes('href="' + item.href + '"'));
  }

  assert.match(html, /demo only/i);
  assert.match(html, /Contract Interface v1/i);
});
