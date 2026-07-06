// Cartoon SVG art for each casino game. Bold, chunky, white-outlined shapes
// with a hard drop shadow so the cards read like sticker-art. `accent` tints
// the hero shape; everything stays in the trench palette.

export function GameArt({ kind, accent = "#a855f7", size = 96 }: { kind: string; accent?: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 120 120",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    style: { filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.35))" },
  };
  const W = "#ffffff";
  const D = "rgba(0,0,0,0.28)";

  switch (kind) {
    case "coin":
      return (
        <svg {...common}>
          <ellipse cx="60" cy="66" rx="34" ry="34" fill={D} />
          <circle cx="60" cy="58" r="34" fill={accent} stroke={W} strokeWidth="5" />
          <circle cx="60" cy="58" r="24" fill="none" stroke={W} strokeWidth="3" opacity="0.8" />
          <path d="M60 44v28M52 52h12a4 4 0 010 8h-8a4 4 0 000 8h12" stroke={W} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="49" cy="48" r="4" fill={W} opacity="0.7" />
        </svg>
      );
    case "dice":
      return (
        <svg {...common}>
          <rect x="16" y="40" width="46" height="46" rx="12" fill={D} />
          <rect x="14" y="34" width="46" height="46" rx="12" fill={accent} stroke={W} strokeWidth="5" transform="rotate(-8 37 57)" />
          <rect x="60" y="42" width="42" height="42" rx="11" fill="#c084fc" stroke={W} strokeWidth="5" transform="rotate(10 81 63)" />
          <circle cx="30" cy="48" r="4" fill={W} /><circle cx="44" cy="66" r="4" fill={W} /><circle cx="30" cy="66" r="4" fill={W} /><circle cx="44" cy="48" r="4" fill={W} />
          <circle cx="72" cy="55" r="4" fill={W} /><circle cx="90" cy="71" r="4" fill={W} /><circle cx="81" cy="63" r="4" fill={W} />
        </svg>
      );
    case "rocket":
      return (
        <svg {...common}>
          <path d="M26 96 Q54 40 96 22" stroke={accent} strokeWidth="7" strokeLinecap="round" opacity="0.55" strokeDasharray="2 12" />
          <path d="M66 26c14-6 26-4 26-4s2 12-4 26c-5 12-20 24-20 24l-14-14s6-20 12-32z" fill={accent} stroke={W} strokeWidth="5" strokeLinejoin="round" />
          <circle cx="76" cy="42" r="6" fill={W} />
          <path d="M54 72l-8 16 16-8" fill="#f97316" stroke={W} strokeWidth="4" strokeLinejoin="round" />
          <path d="M40 84l-10 12" stroke="#f97316" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <rect x="18" y="26" width="84" height="68" rx="12" fill={D} />
          <rect x="16" y="22" width="84" height="68" rx="12" fill="#1e1035" stroke={W} strokeWidth="5" />
          <rect x="30" y="48" width="10" height="26" rx="3" fill="#22c55e" /><path d="M35 40v34" stroke="#22c55e" strokeWidth="3" />
          <rect x="52" y="40" width="10" height="18" rx="3" fill="#ef4444" /><path d="M57 34v30" stroke="#ef4444" strokeWidth="3" />
          <rect x="74" y="34" width="10" height="30" rx="3" fill="#22c55e" /><path d="M79 28v42" stroke="#22c55e" strokeWidth="3" />
          <path d="M28 78 L46 62 L62 70 L86 40" stroke={accent} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "wheel":
      return (
        <svg {...common}>
          <circle cx="60" cy="62" r="34" fill={D} />
          <circle cx="60" cy="58" r="34" fill={accent} stroke={W} strokeWidth="5" />
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1="60" y1="58" x2={60 + 34 * Math.cos((a * Math.PI) / 180)} y2={58 + 34 * Math.sin((a * Math.PI) / 180)} stroke={W} strokeWidth="3" />
          ))}
          <circle cx="60" cy="58" r="10" fill="#1e1035" stroke={W} strokeWidth="4" />
          <circle cx="60" cy="24" r="5" fill={W} />
        </svg>
      );
    case "bullet":
      return (
        <svg {...common}>
          <circle cx="60" cy="62" r="34" fill={D} />
          <circle cx="60" cy="58" r="34" fill="#2e1065" stroke={W} strokeWidth="5" />
          {[0, 60, 120, 180, 240, 300].map((a, i) => (
            <circle key={a} cx={60 + 20 * Math.cos((a * Math.PI) / 180)} cy={58 + 20 * Math.sin((a * Math.PI) / 180)} r="7" fill={i === 0 ? accent : "#120a22"} stroke={W} strokeWidth="3" />
          ))}
          <circle cx="60" cy="58" r="6" fill={W} opacity="0.6" />
        </svg>
      );
    case "vault":
      return (
        <svg {...common}>
          <rect x="20" y="30" width="80" height="64" rx="12" fill={D} />
          <rect x="18" y="26" width="80" height="64" rx="12" fill={accent} stroke={W} strokeWidth="5" />
          <circle cx="58" cy="58" r="20" fill="#1e1035" stroke={W} strokeWidth="5" />
          <circle cx="58" cy="58" r="7" fill={W} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1={58 + 20 * Math.cos((a * Math.PI) / 180)} y1={58 + 20 * Math.sin((a * Math.PI) / 180)} x2={58 + 26 * Math.cos((a * Math.PI) / 180)} y2={58 + 26 * Math.sin((a * Math.PI) / 180)} stroke={W} strokeWidth="4" strokeLinecap="round" />
          ))}
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="M60 100 L26 56 L44 32 H76 L94 56 Z" fill={D} transform="translate(0,4)" />
          <path d="M60 96 L26 52 L44 28 H76 L94 52 Z" fill={accent} stroke={W} strokeWidth="5" strokeLinejoin="round" />
          <path d="M26 52 H94 M44 28 L60 96 L76 28 M44 28 L60 52 L76 28 M26 52 L60 96 L94 52" stroke={W} strokeWidth="3" opacity="0.8" fill="none" strokeLinejoin="round" />
        </svg>
      );
    case "mask":
      return (
        <svg {...common}>
          <path d="M28 40c0-8 8-12 32-12s32 4 32 12c0 26-14 44-32 44S28 66 28 40z" fill={D} transform="translate(0,4)" />
          <path d="M28 38c0-8 8-12 32-12s32 4 32 12c0 26-14 44-32 44S28 64 28 38z" fill={accent} stroke={W} strokeWidth="5" />
          <path d="M40 44c4-4 12-4 16 0M64 44c4-4 12-4 16 0" stroke={W} strokeWidth="5" strokeLinecap="round" />
          <path d="M46 64c8 6 20 6 28 0" stroke={W} strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    case "crown":
      return (
        <svg {...common}>
          <path d="M24 84 L18 40 L40 58 L60 30 L80 58 L102 40 L96 84 Z" fill={D} transform="translate(0,4)" />
          <path d="M24 80 L18 36 L40 54 L60 26 L80 54 L102 36 L96 80 Z" fill={accent} stroke={W} strokeWidth="5" strokeLinejoin="round" />
          <rect x="24" y="82" width="72" height="12" rx="4" fill={accent} stroke={W} strokeWidth="5" />
          <circle cx="60" cy="26" r="6" fill={W} /><circle cx="18" cy="36" r="5" fill={W} /><circle cx="102" cy="36" r="5" fill={W} />
        </svg>
      );
    case "knife":
      return (
        <svg {...common}>
          <path d="M40 20 L64 44 L44 64 L36 56 Z" fill="#cbd5e1" stroke={W} strokeWidth="5" strokeLinejoin="round" transform="rotate(8 50 44)" />
          <rect x="60" y="60" width="28" height="12" rx="4" fill={accent} stroke={W} strokeWidth="5" transform="rotate(45 74 66)" />
          <path d="M78 78 L96 96" stroke={accent} strokeWidth="8" strokeLinecap="round" />
          <path d="M34 74 L20 96" stroke={W} strokeWidth="4" strokeLinecap="round" opacity="0.5" strokeDasharray="2 8" />
        </svg>
      );
    case "gavel":
      return (
        <svg {...common}>
          <rect x="52" y="26" width="30" height="24" rx="8" fill={accent} stroke={W} strokeWidth="5" transform="rotate(45 67 38)" />
          <rect x="44" y="42" width="14" height="44" rx="6" fill="#c084fc" stroke={W} strokeWidth="5" transform="rotate(45 51 64)" />
          <rect x="24" y="94" width="56" height="12" rx="5" fill={accent} stroke={W} strokeWidth="5" />
        </svg>
      );
    case "cards":
      return (
        <svg {...common}>
          <rect x="30" y="34" width="40" height="56" rx="8" fill={D} transform="rotate(-12 50 62)" />
          <rect x="28" y="30" width="40" height="56" rx="8" fill="#f5f3ff" stroke={W} strokeWidth="4" transform="rotate(-12 48 58)" />
          <rect x="54" y="30" width="40" height="56" rx="8" fill={accent} stroke={W} strokeWidth="4" transform="rotate(10 74 58)" />
          <path d="M45 50l4-6 4 6a4 4 0 11-8 0z" fill="#ef4444" transform="rotate(-12 48 58)" />
          <text x="72" y="66" fill={W} fontSize="22" fontWeight="bold" fontFamily="monospace" transform="rotate(10 74 58)">A</text>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="60" cy="60" r="34" fill={accent} stroke={W} strokeWidth="5" />
          <circle cx="60" cy="60" r="12" fill={W} />
        </svg>
      );
  }
}
