// Tiny client helper for filing user reports. Server-side rate-limited
// (5/min, 30/hour) by a Postgres trigger in schema.sql.

import { supabase } from "@/lib/supabase";

export type ReportKind = "post" | "account" | "cabal" | "token" | "dm";
export type ReportReason =
  | "spam" | "scam" | "harassment" | "impersonation" | "nsfw" | "illegal" | "other";

export async function fileReport(
  reporter: string,
  target_kind: ReportKind,
  target_id: string,
  reason: ReportReason,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase().from("reports").insert({
    reporter: reporter.toLowerCase(),
    target_kind,
    target_id,
    reason,
    note: note?.slice(0, 500) ?? null,
  });
  if (error) {
    // Unique constraint => already reported; rate limit => message starts with "rate limit"
    if (error.code === "23505") return { ok: false, error: "You already reported this." };
    if (error.message?.includes("rate limit")) return { ok: false, error: "Too many reports — slow down." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
