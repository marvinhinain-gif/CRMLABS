import { Check, MessageCircle } from "lucide-react";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";

function MiniCard({ label, dot, name, init, tone, className, i }: { label: string; dot: string; name: string; init: string; tone: [string, string]; className?: string; i: number }) {
  return (
    <div className={`anim-rise ${className ?? ""}`} style={{ "--i": i + 4 } as React.CSSProperties}>
    <div className="anim-float relative w-[178px] rounded-[18px] bg-white p-4 shadow-[0_8px_30px_rgb(16_60_48/0.08)]" style={{ "--i": i } as React.CSSProperties}>
      <span className="absolute -top-4 left-1/2 -translate-x-1/2 flex size-8 items-center justify-center rounded-full bg-[#0c8f63] text-white ring-4 ring-[#eaf7f1]">
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </span>
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span className="size-2.5 rounded-full" style={{ background: dot }} />
        {label}
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: tone[0], color: tone[1] }}>
          {init}
        </span>
        <div className="flex-1">
          <p className="text-[12.5px] font-medium text-ink">{name}</p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#eef2f1]" />
          <div className="mt-1 h-1.5 w-2/3 rounded-full bg-[#eef2f1]" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <MessageCircle className="size-4 text-[#0c8f63]" aria-hidden />
        <div className="h-2 flex-1 rounded-full bg-[#eef2f1]">
          <div className="bar-grow h-2 w-3/5 rounded-full bg-[#5fd3a5]" style={{ "--i": i + 8 } as React.CSSProperties} />
        </div>
      </div>
    </div>
    </div>
  );
}

/** Layout de login aprovado: painel institucional verde-claro à esquerda e formulário à direita. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-3">
      <aside className="relative hidden lg:flex flex-col overflow-hidden rounded-[28px] bg-[#eaf7f1] px-14 py-12">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full bg-[#dcf2e8]" />
        <div aria-hidden className="pointer-events-none absolute -left-32 bottom-[-120px] size-[460px] rounded-full bg-[#e1f4eb]" />
        <div className="relative">
          <AnimatedLogo size={36} />
        </div>
        <div className="relative mt-16 max-w-[560px] anim-rise" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 className="text-[46px] xl:text-[52px] font-bold leading-[1.05] tracking-tight text-[#0f1f1a]">
            Relacionamentos que viram resultados<span className="text-brand">.</span>
          </h2>
          <p className="mt-5 text-[19px] leading-relaxed text-muted">Organize suas conversas e acompanhe cada oportunidade.</p>
        </div>
        <div className="relative mt-auto pt-16 pb-6" aria-hidden>
          <svg className="absolute left-0 top-8 w-full" height="120" viewBox="0 0 640 120" fill="none">
            <path className="anim-draw" pathLength={1} d="M100 40 C 200 0, 250 80, 330 70 S 470 40, 560 110" stroke="#3cc48a" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div className="relative flex items-start gap-6">
            <MiniCard i={0} label="Novo contato" dot="#12a26b" name="Ana Souza" init="AS" tone={["#e3f4ec", "#147d55"]} />
            <MiniCard i={1} label="Em conversa" dot="#2f6fdb" name="Pedro Lima" init="PL" tone={["#e7effb", "#2463b5"]} className="mt-10" />
            <MiniCard i={2} label="Oportunidade" dot="#e0a106" name="Camila Santos" init="CS" tone={["#fdf3dc", "#9a6700"]} className="mt-20 hidden xl:block" />
          </div>
        </div>
      </aside>
      <main className="flex min-h-dvh lg:min-h-0 flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-12 sm:py-10">
        <div className="lg:hidden mb-8 flex justify-center sm:justify-start">
          <AnimatedLogo size={34} />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[460px] anim-rise" style={{ "--i": 3 } as React.CSSProperties}>
            {children}
          </div>
        </div>
        <p className="pt-10 text-center text-[13px] text-muted">© {new Date().getFullYear()} CRMLABS</p>
      </main>
    </div>
  );
}
