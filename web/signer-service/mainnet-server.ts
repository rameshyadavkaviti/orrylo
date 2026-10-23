import { createServer } from "node:http";

import {
  handlePrivateMainnetSignerRequest,
  readPrivateMainnetSignerRuntime,
} from "./private-mainnet-signer";

async function main() {
  let runtime;
  const port = Number(process.env.PORT);
  try {
    runtime = readPrivateMainnetSignerRuntime();
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new Error("invalid port");
    }
  } catch {
    process.stderr.write("Mainnet signer configuration rejected.\n");
    process.exitCode = 1;
    return;
  }
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://signer.railway.internal").pathname;
    const result = await handlePrivateMainnetSignerRequest(
      {
        method: request.method ?? "",
        path,
        authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : null,
        readBody: async () => "",
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
    process.stdout.write(`${JSON.stringify({event: "private_mainnet_signer_ready", network: "public", signerPublicKey: runtime.signerPublicKey, signingEnabled: false})}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

void main();
