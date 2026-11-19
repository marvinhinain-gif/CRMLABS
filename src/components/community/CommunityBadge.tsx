import { Crown } from "lucide-react";
import { clsx as cx } from "clsx";

/** Selo "Comunidade" (El Club): lead vindo do CRM da Comunidade. Roxo para destacar do verde da marca. */
export function CommunityBadge({ size = "md", label = "Comunidade", className }: { size?: "sm" | "md"; label?: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-[#d9c9fb] bg-[#f1ebff] font-semibold text-[#5b21b6]",
        size === "sm" ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-0.5 text-[12.5px]",
        className,
      )}
      title="Lead da comunidade El Club"
    >
      <Crown className={cx("shrink-0", size === "sm" ? "size-3" : "size-3.5")} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
