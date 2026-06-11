// Reusable MON (Monad native currency) logo. Use anywhere a token-icon
// slot is needed alongside the symbol "MON". Sized via `size` prop;
// extra Tailwind via `className`.

import { MON_LOGO } from "@/lib/brand";

export function MonLogo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={MON_LOGO}
      alt="MON"
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
