import type { ReactNode } from "react";

interface StatusPillProps {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning";
}

export function StatusPill({
  children,
  tone = "neutral",
}: StatusPillProps) {
  return <span className={"status-pill status-" + tone}>{children}</span>;
}
