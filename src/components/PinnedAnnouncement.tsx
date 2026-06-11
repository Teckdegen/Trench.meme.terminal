// Pinned-to-top announcement card. Renders the latest post from the
// trenchmem handle with a distinctive gold-tinted border + Pin chip.

import { useLatestAnnouncement } from "@/lib/announcements";
import { ANNOUNCEMENT_HANDLE, APP_LOGO, VERIFIED_BADGE } from "@/lib/brand";
import { Megaphone, Pin } from "lucide-react";

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function PinnedAnnouncement() {
  const post = useLatestAnnouncement();
  if (!post) return null;

  return (
    <article
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(251,191,36,0.06), rgba(168,85,247,0.06))",
        border: "1px solid rgba(251,191,36,0.35)",
        boxShadow: "0 0 30px -10px rgba(251,191,36,0.35)",
      }}
    >
      {/* Pinned chip */}
      <div
        className="absolute top-2 left-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ background: "rgba(251,191,36,0.18)", color: "#fbbf24" }}
      >
        <Pin className="size-3" /> Pinned · Announcement
      </div>

      <div className="flex gap-3 px-4 pt-9 pb-4">
        <img
          src={APP_LOGO}
          alt="trench.meme"
          className="size-11 rounded-full object-cover ring-2"
          style={{ boxShadow: "0 0 0 2px rgba(251,191,36,0.45)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-bold">trench.meme</span>
            <img src={VERIFIED_BADGE} alt="Verified" className="size-4" />
            <span className="text-muted-foreground">@{ANNOUNCEMENT_HANDLE}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{timeAgo(post.created_at)}</span>
            <Megaphone className="size-3.5 text-[#fbbf24] ml-1" />
          </div>
          <p className="text-[15px] leading-snug mt-1 whitespace-pre-wrap break-words">
            {post.body}
          </p>
        </div>
      </div>
    </article>
  );
}
