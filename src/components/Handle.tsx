import { Link } from "@tanstack/react-router";
import { useIdentity, labelFor, profileSlug, profileRoute } from "@/lib/identity";
import { defaultDisplayName } from "@/lib/handles";
import { DEFAULT_AVATAR } from "@/lib/defaults";

type HandleProps = {
  address?: string;
  className?: string;
  /** Prefix with @ (default true). */
  at?: boolean;
};

/** Renders @handle (or display name) — never a raw wallet address. */
export function Handle({ address, className, at = true }: HandleProps) {
  const id = useIdentity(address);
  return <span className={className}>{labelFor(id, { at })}</span>;
}

type HandleLinkProps = HandleProps & {
  onClick?: (e: React.MouseEvent) => void;
};

/** Prefer Nad.fun nickname, else resolved @handle — never raw 0x. */
export function WalletLabel({
  address,
  nickname,
  className,
}: {
  address: string;
  nickname?: string | null;
  className?: string;
}) {
  const id = useIdentity(address);
  const text = nickname?.trim() || labelFor(id, { at: true });
  const slug = profileSlug(id);
  const display = text === "…" ? defaultDisplayName(address) : text;
  if (slug) {
    return (
      <Link {...profileRoute(slug)} className={className}>
        {display}
      </Link>
    );
  }
  return <span className={className}>{display}</span>;
}

/** Profile picture for a wallet. Reads from the same identity cache as
 *  <Handle>, so once a user uploads/edits their avatar it propagates to
 *  every chat, comment, member list, and trade row showing them.
 *
 *  Renders a real <img> if the user has an image_uri set; otherwise a
 *  trench-purple monogram fallback (last 2 hex chars).
 */
export function UserAvatar({
  address,
  size = 36,
  className,
  ring,
}: {
  address?: string;
  size?: number;
  className?: string;
  /** Add a 2px background-colored ring (looks nice on dense lists). */
  ring?: boolean;
}) {
  const id = useIdentity(address);
  const src = id?.image_uri;
  const px = `${size}px`;
  const fontSize = Math.max(9, Math.round(size * 0.32));
  const ringCls = ring ? "ring-2 ring-background" : "";
  if (src) {
    return (
      <img
        key={src}
        src={src}
        alt=""
        style={{ width: px, height: px }}
        className={`rounded-full object-cover shrink-0 ${ringCls} ${className ?? ""}`}
        onError={(e) => {
          // Broken image → swap to default avatar, no infinite loop
          const el = e.currentTarget as HTMLImageElement;
          if (el.src !== DEFAULT_AVATAR) el.src = DEFAULT_AVATAR;
        }}
      />
    );
  }
  const initials = (address ?? "0x").slice(-2).toUpperCase();
  return (
    <div
      style={{ width: px, height: px, fontSize }}
      className={`rounded-full grid place-items-center font-mono font-bold shrink-0 bg-primary/15 text-primary border border-primary/20 ${ringCls} ${className ?? ""}`}
    >
      {initials}
    </div>
  );
}

/** Links to /profile/@handle when a handle exists; otherwise plain text. */
export function HandleLink({ address, className, at = true, onClick }: HandleLinkProps) {
  const id = useIdentity(address);
  const slug = profileSlug(id);
  const text = labelFor(id, { at });
  if (!slug) {
    return <span className={className}>{text}</span>;
  }
  return (
    <Link
      {...profileRoute(slug)}
      className={className}
      onClick={onClick}
    >
      {text}
    </Link>
  );
}
