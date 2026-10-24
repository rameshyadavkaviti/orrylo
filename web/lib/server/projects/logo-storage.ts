import { createHash, createHmac } from "node:crypto";

const MAX_BYTES = 2 * 1024 * 1024;
export type LogoType = "image/png" | "image/jpeg" | "image/webp";

export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (bytes.length < 12 || bytes.length > MAX_BYTES) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function logoObjectKey(projectId: string, digest: string, type: LogoType): string {
  const ext = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  return `logos/${projectId}/${digest}.${ext}`;
}

interface StorageConfig {
  endpoint: URL;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  style: "path" | "virtual-host";
}

function config(): StorageConfig {
  const endpoint = process.env.ORRYLO_LOGO_S3_ENDPOINT;
  const bucket = process.env.ORRYLO_LOGO_S3_BUCKET;
  const region = process.env.ORRYLO_LOGO_S3_REGION;
  const accessKey = process.env.ORRYLO_LOGO_S3_ACCESS_KEY_ID;
  const secretKey = process.env.ORRYLO_LOGO_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !region || !accessKey || !secretKey) {
    throw new Error("Logo object storage is not configured.");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid logo storage endpoint.");
  }
  return {
    endpoint: url, bucket, region, accessKey, secretKey,
    style: process.env.ORRYLO_LOGO_S3_URL_STYLE === "virtual-host" ? "virtual-host" : "path",
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function signedRequest(method: "GET" | "PUT", key: string, payload: Uint8Array, type?: LogoType) {
  const c = config();
  const url = new URL(c.endpoint);
  if (c.style === "virtual-host") url.hostname = `${c.bucket}.${url.hostname}`;
  const segments = [...(c.style === "path" ? [c.bucket] : []), ...key.split("/")];
  url.pathname = "/" + segments.map(encodeURIComponent).join("/");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const hash = createHash("sha256").update(payload).digest("hex");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": hash,
    "x-amz-date": amzDate,
  };
  if (type) headers["content-type"] = type;
  const sorted = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = sorted.map(([name, value]) => `${name}:${value.trim()}\n`).join("");
  const signedHeaders = sorted.map(([name]) => name).join(";");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, hash].join("\n");
  const scope = `${date}/${c.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + c.secretKey, date), c.region), "s3"), "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host; // fetch sets the same Host header from the URL.
  return { url, headers };
}

export async function storeLogo(key: string, bytes: Uint8Array, type: LogoType): Promise<void> {
  const { url, headers } = signedRequest("PUT", key, bytes, type);
  const response = await fetch(url, { method: "PUT", headers, body: Buffer.from(bytes), cache: "no-store" });
  if (!response.ok) throw new Error(`Logo storage PUT failed: ${response.status}`);
}

export async function readLogo(key: string): Promise<Uint8Array | null> {
  const { url, headers } = signedRequest("GET", key, new Uint8Array());
  const response = await fetch(url, { headers, cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Logo storage GET failed: ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) throw new Error("Stored logo exceeds size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("Stored logo exceeds size limit.");
  return bytes;
}
