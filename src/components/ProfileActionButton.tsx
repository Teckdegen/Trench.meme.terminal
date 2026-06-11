import { Link } from "@tanstack/react-router";
import { Pencil, UserPlus } from "lucide-react";
import { useFollow } from "@/lib/supabase-hooks";
import { isOwnAccount } from "@/lib/own-profile";
import { useMounted } from "@/lib/useMounted";

type Variant = "default" | "compact";

const styles: Record<Variant, { btn: string; icon: string }> = {
  default: {
    btn: "h-10 px-5 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed",
    icon: "size-4",
  },
  compact: {
    btn: "h-7 px-3 rounded-full text-[11px] font-bold shrink-0 disabled:opacity-50 disabled:cursor-not-allowed",
    icon: "size-3",
  },
};

/** Follow / Following for others; Edit profile (opens modal or navigates with ?edit=1) for self. */
export function ProfileActionButton({
  targetAddress,
  targetHandle,
  me,
  myHandle,
  variant = "default",
  onEditOwnProfile,
  className,
}: {
  targetAddress?: string;
  targetHandle?: string | null;
  me: string | undefined;
  myHandle?: string | null;
  variant?: Variant;
  /** When already on your profile page — opens the edit modal in place. */
  onEditOwnProfile?: () => void;
  className?: string;
}) {
  const mounted = useMounted();
  const follow = useFollow(targetAddress);
  const s = styles[variant];
  const isOwn = isOwnAccount(
    me,
    targetAddress,
    targetHandle ?? "",
    myHandle,
  );

  if (!mounted) {
    return (
      <span
        className={`${s.btn} bg-surface-2 opacity-40 ${className ?? ""}`}
        aria-hidden
      />
    );
  }

  if (isOwn) {
    const slug = (myHandle ?? targetHandle)?.replace(/^@/, "").toLowerCase();
    if (onEditOwnProfile) {
      return (
        <button
          type="button"
          onClick={onEditOwnProfile}
          className={`${s.btn} bg-surface-2 hover:bg-white/10 ${className ?? ""}`}
        >
          <Pencil className={s.icon} />
          Edit profile
        </button>
      );
    }
    if (!slug) return null;
    return (
      <Link
        to="/@{$handle}"
        params={{ handle: slug }}
        search={{ edit: true }}
        className={`${s.btn} bg-surface-2 hover:bg-white/10 ${className ?? ""}`}
      >
        <Pencil className={s.icon} />
        Edit profile
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={follow.toggle}
      disabled={!me || !follow.canFollow}
      className={`${s.btn} ${
        follow.isFollowing ? "bg-surface-2 text-foreground" : "lit-purple"
      } ${className ?? ""}`}
    >
      <UserPlus className={s.icon} />
      {follow.isFollowing ? "Following" : "Follow"}
    </button>
  );
}
