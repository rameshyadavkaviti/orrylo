import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";
import { chromium } from "playwright";

const ORIGIN = "https://orrylo.com";
const SMOKE_BRANCH = "verify/production-project-save-smoke-20261012";

test(
  "production wallet-authenticated Save & manage project browser smoke",
  { timeout: 120_000 },
  async (context) => {
    if (process.env.GITHUB_HEAD_REF !== SMOKE_BRANCH) {
      context.skip("Production smoke runs only on its isolated verification PR.");
      return;
    }

    const home = await fetch(ORIGIN);
    assert.equal(home.status, 200, "Production homepage must return HTTP 200.");
    assert.match(await home.text(), /Create your Stellar token in minutes/);

    // Ephemeral test wallet. The seed is never logged or written anywhere.
    const wallet = Keypair.fromRawEd25519Seed(randomBytes(32));

    const challengeResponse = await fetch(`${ORIGIN}/api/auth/challenge`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    assert.equal(challengeResponse.status, 200);
    const challenge = (await challengeResponse.json()) as {
      id: string;
      payload: string;
    };
    assert.ok(challenge.id);
    assert.ok(challenge.payload);

    const signedMessage = `${wallet.publicKey()}:${challenge.payload}`;
    const signature = Buffer.from(
      wallet.sign(createHash("sha256").update(signedMessage).digest()),
    ).toString("hex");

    const verifyResponse = await fetch(`${ORIGIN}/api/auth/verify`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: {
          pubkey: wallet.publicKey(),
          signed_message: signedMessage,
          signature,
        },
      }),
    });

    assert.equal(verifyResponse.status, 200);
    const verified = (await verifyResponse.json()) as {
      authenticated: boolean;
      publicKey: string;
    };
    assert.equal(verified.authenticated, true);
    assert.equal(verified.publicKey, wallet.publicKey());

    const sessionCookie = verifyResponse.headers
      .get("set-cookie")
      ?.match(/orrylo_session=([^;]+)/)?.[1];
    assert.ok(sessionCookie, "Wallet authentication must issue a session.");

    const sessionResponse = await fetch(`${ORIGIN}/api/auth/session`, {
      headers: { Cookie: `orrylo_session=${sessionCookie}` },
    });
    assert.equal(sessionResponse.status, 200);
    const session = (await sessionResponse.json()) as {
      authenticated: boolean;
      publicKey: string;
    };
    assert.equal(session.authenticated, true);
    assert.equal(session.publicKey, wallet.publicKey());

    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--no-sandbox"],
    });

    try {
      const browserContext = await browser.newContext();
      await browserContext.addCookies([
        {
          name: "orrylo_session",
          value: sessionCookie,
          domain: "orrylo.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);

      const page = await browserContext.newPage();
      const builder = await page.goto(`${ORIGIN}/create-token`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(builder?.status(), 200);

      const code = `Q${randomBytes(5).toString("hex").toUpperCase()}`;
      const displayName = `Orrylo Smoke ${code}`;
      await page.locator('input[name="code"]').fill(code);
      await page.locator('input[name="displayName"]').fill(displayName);
      await page
        .locator('textarea[name="description"]')
        .fill("Production deployment verification only; no asset issuance.");

      let savePayload: unknown;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/projects"
        ) {
          savePayload = request.postDataJSON();
        }
      });

      const resultPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/projects",
        { timeout: 30_000 },
      );

      await page
        .getByRole("button", { name: "Save & manage project" })
        .click();

      const resultResponse = await resultPromise;
      assert.equal(
        resultResponse.status(),
        201,
        `POST /api/projects returned ${resultResponse.status()}`,
      );

      // Next.js navigates immediately on success, so the old response body
      // may no longer be accessible via Chrome DevTools.
      await page.waitForURL(
        (url) => url.pathname.startsWith("/my-assets/"),
        { timeout: 30_000 },
      );
      const projectId = new URL(page.url()).pathname.split("/").pop();
      assert.ok(projectId);
      await page.getByText(displayName).first().waitFor({ timeout: 15_000 });

      assert.ok(savePayload, "Browser must submit the project-save payload.");

      const replay = await fetch(`${ORIGIN}/api/projects`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          Cookie: `orrylo_session=${sessionCookie}`,
        },
        body: JSON.stringify(savePayload),
      });
      assert.equal(replay.status, 200);
      const replayResult = (await replay.json()) as {
        ok: boolean;
        created: boolean;
        projectId: string;
        slug: string;
        publicStatus: string;
      };
      assert.equal(replayResult.ok, true);
      assert.equal(replayResult.created, false);
      assert.equal(replayResult.projectId, projectId);
      assert.equal(replayResult.publicStatus, "draft");

      console.log(
        `PRODUCTION_SMOKE_PASS projectId=${projectId} slug=${replayResult.slug} post=201 replay=200 ui=managed_page`,
      );
    } finally {
      await browser.close();
    }
  },
);
