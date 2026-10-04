/**
 * Logo CRMLABS — versão SVG PROVISÓRIA fiel ao conceito aprovado
 * (funil em três faixas arredondadas + "CRM" verde-escuro e "LABS" verde).
 * Substitua pelo ativo oficial quando disponível (ver README).
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={(size * 56) / 64} viewBox="0 0 64 56" aria-hidden="true" className={className}>
      <g fill="#00A878" stroke="#00A878" strokeWidth="4" strokeLinejoin="round">
        <rect x="2" y="2" width="60" height="15" rx="7.5" stroke="none" />
        <path d="M12 23 H52 L45 34 H19 Z" />
        <path d="M24 40 H40 L35.5 50 H28.5 Z" />
      </g>
    </svg>
  );
}

export function Logo({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`} aria-label="CRMLABS">
      <LogoMark size={size} />
      <span className="font-bold tracking-tight leading-none" style={{ fontSize: size * 0.82 }} aria-hidden="true">
        <span style={{ color: "#103C30" }}>CRM</span>
        <span style={{ color: "#00A878" }}>LABS</span>
      </span>
    </span>
  );
}
