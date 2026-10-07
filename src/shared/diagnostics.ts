export type DiagnosticState =
  | "connected"
  | "failed"
  | "not_configured"
  | "not_integrated";

export type DiagnosticGroup = "local" | "ai";

export interface DiagnosticItem {
  id: string;
  label: string;
  group: DiagnosticGroup;
  state: DiagnosticState;
  detail: string;
  latencyMs?: number;
}

export interface DiagnosticReport {
  checkedAt: string;
  items: DiagnosticItem[];
}
