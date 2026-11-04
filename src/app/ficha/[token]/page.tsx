import type { Metadata } from "next";
import { getSharedLead, type SharedLead } from "@/server/services/leadShare";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import { formatDateTime, formatPhone, longDayTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await getSharedLead((await params).token);
  return {
    title: l ? `Ficha de ${l.name}${l.orgName ? ` · ${l.orgName}` : ""}` : "Link desativado",
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[15px] text-ink">{children}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_10px_40px_rgb(16_60_48/0.08)] sm:p-6">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Ficha({ l }: { l: SharedLead }) {
  const s = l.leadScore;
  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-[24px] bg-white p-5 shadow-[0_10px_40px_rgb(16_60_48/0.08)] sm:p-6">
        <p className="text-[12.5px] font-medium uppercase tracking-wide text-brand">Ficha do lead{l.orgName ? ` · ${l.orgName}` : ""}</p>
        <h1 className="mt-1 break-words text-[24px] font-bold leading-tight">{l.name}</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {l.formName ?? "Cadastro"} · recebido em {formatDateTime(l.createdAt)}
          {l.sourceName ? ` · origem ${l.sourceName}` : ""}
        </p>
        {s && (
          <div className="mt-4 flex items-center gap-3 rounded-[18px] bg-page p-3.5">
            {s.score != null && (
              <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-[16px] bg-white leading-none">
                <span className="text-[20px] font-semibold">{s.score}</span>
                <span className="mt-0.5 text-[11px] text-muted">de 100</span>
              </span>
            )}
            <span className="min-w-0 text-[13px] text-muted">
              <span className="block text-[14.5px] font-semibold text-ink">Lead score: {s.label}</span>
              {s.tierLabel && <span className="block">{s.tierLabel}</span>}
              {s.productLabel && <span className="block">Sugestão do quiz: {s.productLabel}</span>}
            </span>
          </div>
        )}
      </header>

      <Card title="Contato">
        <dl className="mt-1 divide-y divide-line">
          <Row label="Nome">{l.name}</Row>
          {l.phone && (
            <Row label="WhatsApp">
              <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                {formatPhone(l.phone)}
              </a>
            </Row>
          )}
          {l.email && (
            <Row label="E-mail">
              <a href={`mailto:${l.email}`} className="font-medium text-brand hover:underline">
                {l.email}
              </a>
            </Row>
          )}
          {l.instagram && (
            <Row label="Instagram">
              <a href={`https://www.instagram.com/${l.instagram}/`} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                @{l.instagram}
              </a>
            </Row>
          )}
          {(l.preferredAt || l.preferredText) && <Row label="Melhor horário para conversar">{l.preferredAt ? longDayTime(l.preferredAt) : l.preferredText}</Row>}
        </dl>
      </Card>

      <Card title={`Respostas${l.formName ? ` · ${l.formName}` : ""}`}>
        {l.productName || l.customValues.length || l.answers.length ? (
          <dl className="mt-1 divide-y divide-line">
            {l.productName && <Row label="Produto de interesse">{l.productName}</Row>}
            {l.customValues.map((c) => (
              <Row key={c.label} label={c.label}>
                {c.value}
              </Row>
            ))}
            {l.answers.map((a, i) => (
              <Row key={i} label={a.label}>
                {a.value || "—"}
              </Row>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-[14px] text-muted">Este cadastro não tem outras respostas além dos dados de contato.</p>
        )}
      </Card>

      {l.quiz && (
        <Card title={`Quiz · ${l.quiz.title}`}>
          <p className="mt-1 text-[12.5px] text-muted">Respondido em {formatDateTime(l.quiz.completedAt)}</p>
          <dl className="mt-1 divide-y divide-line">
            {l.quiz.answers.map((a, i) => (
              <Row key={i} label={a.label}>
                {a.value || "—"}
              </Row>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}

/** Ficha do lead compartilhada por link: só leitura, sem login. O link pode ser desativado no CRM. */
export default async function Page({ params }: Props) {
  const l = await getSharedLead((await params).token);
  return (
    <div className="min-h-dvh bg-[#f2faf6]">
      <main className="relative mx-auto flex min-h-dvh max-w-[640px] flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-10">
        <div className="mb-6 flex justify-center">
          <AnimatedLogo size={30} />
        </div>
        {l ? (
          <Ficha l={l} />
        ) : (
          <div className="rounded-[24px] bg-white p-8 text-center shadow-[0_10px_40px_rgb(16_60_48/0.08)]">
            <h1 className="text-[22px] font-bold">Link desativado</h1>
            <p className="mt-2 text-[15px] text-muted">Esta ficha não está mais compartilhada. Peça um novo link a quem enviou.</p>
          </div>
        )}
        <p className="mt-auto pt-8 text-center text-[12px] text-muted">Ficha compartilhada pelo CRMLABS. Somente leitura.</p>
      </main>
    </div>
  );
}
