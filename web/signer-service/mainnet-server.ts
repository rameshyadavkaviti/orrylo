import { createServer, type IncomingMessage } from "node:http";

import {
  createPrivateMainnetSignerRuntime,
  handlePrivateMainnetSignerRequest,
} from "./private-mainnet-signer";

const MAX_REQUEST_BYTES = 32 * 1024;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) throw new Error("request too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error("invalid port");
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("invalid port");
  }
  return port;
}

async function main() {
  let runtime;
  let port: number;
  try {
    runtime = createPrivateMainnetSignerRuntime();
    port = readPort(process.env);
  } catch {
    process.stderr.write("Mainnet signer service configuration rejected.\n");
    process.exitCode = 1;
    return;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      "http://orrylo-mainnet-signer.railway.internal",
    );
    if (request.method === "GET" && url.pathname === "/healthz") {
      if (request.headers.authorization !== `Bearer ${runtime.authToken}`) {
        response.writeHead(401, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ok: false, code: "unauthorized" }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({
        ok: true,
        ready: true,
        service: "orrylo-mainnet-signer",
        network: "public",
        issuerPublicKey: runtime.issuerPublicKey,
        signerPublicKey: runtime.signerPublicKey,
        signingEnabled: runtime.signingEnabled,
      }));
      return;
    }
    if (url.pathname !== "/v1/sign-and-submit") {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }
    let body: string;
    try {
      body = await readBody(request);
    } catch {
      response.writeHead(413, { "cache-control": "no-store" });
      response.end();
      return;
    }
    const method = request.method ?? "";
    const result = await handlePrivateMainnetSignerRequest(
      new Request("http://orrylo-mainnet-signer.railway.internal/v1/sign-and-submit", {
        method,
        headers: {
          authorization:
            typeof request.headers.authorization === "string"
              ? request.headers.authorization
              : "",
          "content-type": "application/json",
        },
        ...(method === "POST" ? { body } : {}),
      }),
      runtime,
    );
    response.writeHead(result.status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(await result.text());
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.listen(port, "::", () => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      service: "orrylo-mainnet-signer",
      network: "public",
      issuerPublicKey: runtime.issuerPublicKey,
      signerPublicKey: runtime.signerPublicKey,
      signingEnabled: runtime.signingEnabled,
    })}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

void main();
