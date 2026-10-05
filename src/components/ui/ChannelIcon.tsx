/** Indicador genérico de canal (câmera arredondada) — não reproduz a marca do Instagram. */
export function InstagramGlyph({ size = 20, className, color = "#d6336c" }: { size?: number; className?: string; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} role="img" aria-label="Instagram">
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke={color} strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.2" fill={color} />
    </svg>
  );
}

/** Ícone do menu (mesmo traço dos demais ícones). */
export function InstagramNavIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Selo pequeno do canal sobre o avatar. */
export function ChannelBadge({ className }: { className?: string }) {
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full bg-white ring-2 ring-white ${className ?? ""}`} aria-hidden>
      <InstagramGlyph size={13} />
    </span>
  );
}
