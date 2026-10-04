/** Indicador genérico de canal (câmera arredondada) — não reproduz a marca do Instagram. */
export function InstagramGlyph({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} role="img" aria-label="Instagram">
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke="#d6336c" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="#d6336c" strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.2" fill="#d6336c" />
    </svg>
  );
}
