import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultAccountHandle, defaultDisplayName } from "@/lib/handles";

export const registerParaWallet = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    paraUserId?: string | null;
    walletId: string;
    session?: string | null;
    sessionCookie?: string | null;
  }) => d)
  .handler(async ({ data }) => {
    const admin = supabaseAdmin();
    const addr = data.owner.toLowerCase();

    await admin.from("para_wallets").upsert({
      owner_address: addr,
      para_user_id: data.paraUserId ?? null,
      wallet_id: data.walletId,
      session: data.session ?? null,
      session_cookie: data.sessionCookie ?? null,
      chain_type: "ethereum",
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_address" });

    await admin.from("accounts").upsert({
      address: addr,
      handle: defaultAccountHandle(addr),
      display_name: defaultDisplayName(addr),
      image_uri: "https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg",
    }, { onConflict: "address", ignoreDuplicates: true });

    return { ok: true };
  });

export const executeServerSwap = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    venue: "nadfun" | "dirol" | "auto";
    side: "BUY" | "SELL";
    tokenAddress: string;
    amountIn: string;
    slippageBps?: number;
    source?: "market" | "limit" | "copy";
  }) => d)
  .handler(async ({ data }) => {
    const { fireWithPara } = await import("./para-server-execute");
    return await fireWithPara({
      owner: data.owner.toLowerCase(),
      venue: data.venue,
      side: data.side,
      tokenAddress: data.tokenAddress.toLowerCase(),
      amountIn: BigInt(data.amountIn),
      slippageBps: data.slippageBps ?? 50,
      source: data.source ?? "market",
    });
  });
