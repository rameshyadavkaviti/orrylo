import { createServer, type IncomingMessage } from "node:http";

import {
  createPrivateTestnetSignerStartupEvidence,
  handlePrivateTestnetSignerRequest,
  readPrivateTestnetSignerRuntime,
} from "./private-testnet-signer";

const MAX_REQUEST_BYTES = 32 * 1024;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("request too large");
    }
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
    runtime = readPrivateTestnetSignerRuntime();
    port = readPort(process.env);
  } catch {
    process.stderr.write("Signer service configuration rejected.\n");
    process.exitCode = 1;
    return;
  }

  const server = createServer(async (request, response) => {
    const path = new URL(
      request.url ?? "/",
      "http://orrylo-signer.railway.internal",
    ).pathname;

    const result = await handlePrivateTestnetSignerRequest(
      {
        method: request.method ?? "",
        path,
        authorization:
          typeof request.headers.authorization === "string"
            ? request.headers.authorization
            : null,
        readBody: () => readBody(request),
      },
      runtime,
    );

    response.writeHead(result.status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(result.body));
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  server.listen(port, "::", () => {
    // Public keys are non-secret activation evidence. Never log credentials,
    // request headers, XDR, transaction hashes or request/response bodies.
    process.stdout.write(
      `${JSON.stringify(createPrivateTestnetSignerStartupEvidence(runtime))}\n`,
    );
  });

  const stop = () => {
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

void main();
