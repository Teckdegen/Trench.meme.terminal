// Agora RTC token mint. One room = one Agora channel; the channel name is the
// rooms.id (UUID) so it's stable + permission-checkable.

import { createServerFn } from "@tanstack/react-start";
import { RtcTokenBuilder, RtcRole } from "agora-token";

const APP_ID = process.env.AGORA_APP_ID ?? "";
const APP_CERT = process.env.AGORA_APP_CERTIFICATE ?? "";

export const VITE_AGORA_APP_ID = process.env.VITE_AGORA_APP_ID ?? "";

export const agoraToken = createServerFn({ method: "POST" })
  .inputValidator((d: { roomId: string; uid: string; canPublish?: boolean }) => d)
  .handler(async ({ data }) => {
    if (!APP_ID || !APP_CERT) throw new Error("Agora not configured");
    // Agora UIDs must be uint32 — hash the wallet address into one
    const numericUid = walletToUid(data.uid);
    const ttlSeconds = 60 * 60;                              // 1h
    const expireAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const role = data.canPublish !== false ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID, APP_CERT,
      data.roomId,           // channel name
      numericUid,
      role,
      expireAt, expireAt,
    );
    return { token, appId: APP_ID, channel: data.roomId, uid: numericUid };
  });

// Stable 32-bit hash so the same wallet always maps to the same Agora UID
function walletToUid(addr: string): number {
  let h = 0;
  const s = addr.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // Force into the 1..2^31 range (Agora rejects 0)
  return (h & 0x7fffffff) || 1;
}
