"use client";

import { useId } from "react";

/**
 * Logo animada das telas de entrada: as três faixas do funil caem e se encaixam,
 * o nome aparece em seguida e, em repetição suave, uma gota atravessa o funil
 * enquanto um brilho passa pelas faixas. Desliga com "reduzir movimento".
 */
export function AnimatedLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const clip = `logo-clip-${id}`;
  const grad = `logo-grad-${id}`;
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`} role="img" aria-label="CRMLABS">
      <svg width={size} height={(size * 56) / 64} viewBox="0 0 64 56" aria-hidden="true" className="overflow-visible">
        <defs>
          <clipPath id={clip}>
            <rect x="2" y="2" width="60" height="15" rx="7.5" />
            <path d="M12 23 H52 L45 34 H19 Z" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
            <path d="M24 40 H40 L35.5 50 H28.5 Z" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
          </clipPath>
          <linearGradient id={grad} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="#00A878" stroke="#00A878" strokeWidth="4" strokeLinejoin="round">
          <rect className="logo-band" x="2" y="2" width="60" height="15" rx="7.5" stroke="none" />
          <path className="logo-band" style={{ animationDelay: "0.14s" }} d="M12 23 H52 L45 34 H19 Z" />
          <path className="logo-band" style={{ animationDelay: "0.28s" }} d="M24 40 H40 L35.5 50 H28.5 Z" />
        </g>
        <g clipPath={`url(#${clip})`}>
          <g transform="skewX(-18)">
            <rect className="logo-shine" x="0" y="-4" width="26" height="64" fill={`url(#${grad})`} />
          </g>
        </g>
        <circle className="logo-drop" cx="32" cy="9.5" r="3.2" fill="#103C30" />
      </svg>
      <span className="font-bold tracking-tight leading-none" style={{ fontSize: size * 0.82 }} aria-hidden="true">
        <span className="logo-word" style={{ color: "#103C30" }}>
          CRM
        </span>
        <span className="logo-word" style={{ color: "#00A878" }}>
          LABS
        </span>
      </span>
    </span>
  );
}
