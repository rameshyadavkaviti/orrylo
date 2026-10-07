import { SESSION_COOKIE_NAME } from "./constants";

export interface SessionCookiePolicy {
  name: typeof SESSION_COOKIE_NAME;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}

export function createSessionCookiePolicy(
  expiresAt: number,
  nodeEnv = process.env.NODE_ENV,
): SessionCookiePolicy {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  };
}

export function createExpiredSessionCookiePolicy(
  nodeEnv = process.env.NODE_ENV,
): SessionCookiePolicy {
  return createSessionCookiePolicy(0, nodeEnv);
}
