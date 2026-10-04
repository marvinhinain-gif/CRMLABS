"use client";

import { useEffect, useRef, useState } from "react";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Número que "conta" até o valor final (e entre valores quando o filtro muda).
 * Leitores de tela recebem só o valor final.
 */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("pt-BR"), duration = 1100, delay = 0 }: { value: number; format?: (n: number) => string; duration?: number; delay?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    let t0: number | null = null;
    const step = (now: number) => {
      t0 ??= now + delay;
      const p = Math.min(1, Math.max(0, (now - t0) / duration));
      const v = start + (value - start) * ease(p);
      setShown(v);
      from.current = v;
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration, delay]);

  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
