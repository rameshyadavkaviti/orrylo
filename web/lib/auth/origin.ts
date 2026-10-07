export function isTrustedAuthOrigin(
  origin: string | null,
  expectedDomain: string,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);

    if (url.hostname !== expectedDomain) {
      return false;
    }

    if (nodeEnv === "production" && url.protocol !== "https:") {
      return false;
    }

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
