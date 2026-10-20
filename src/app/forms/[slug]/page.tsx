import type { Metadata } from "next";
import { getPublicQuiz } from "@/server/services/quizPublic";
import { publicUrl } from "@/server/services/quizzes";
import { QuizRunner } from "@/components/forms/QuizRunner";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string; fullscreen?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const q = await getPublicQuiz((await params).slug);
  return {
    title: q.status === "ok" ? { absolute: `${q.definition.settings.title} · ${q.orgName}` } : "Formulário indisponível",
    description: q.status === "ok" ? (q.definition.settings.description ?? undefined) : undefined,
    robots: { index: false, follow: false },
  };
}

/** Formulário público (link ou incorporado). Não exige login; funciona mesmo sem sessão do CRM. */
export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const embed = sp.embed === "1";
  const fullscreen = embed && sp.fullscreen === "1";
  const q = await getPublicQuiz(slug);
  if (q.status !== "ok") {
    const text =
      q.reason === "not_found"
        ? "Não encontramos este formulário. Confira se o link está completo."
        : q.reason === "archived"
          ? "Este formulário foi encerrado e não recebe mais respostas."
          : "Este formulário está temporariamente indisponível. Tente novamente mais tarde.";
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4">
        <div className="anim-rise max-w-[440px] rounded-[24px] border border-line p-8 text-center shadow-[var(--shadow-soft)]">
          {q.orgName && <p className="text-[14px] font-bold tracking-[0.18em] text-brand">{q.orgName.toUpperCase()}</p>}
          <h1 className="mt-3 text-[22px] font-bold">Formulário indisponível</h1>
          <p className="mt-2 text-[15px] text-muted">{text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={embed && !fullscreen ? undefined : "min-h-dvh"} style={{ background: q.definition.appearance.background }}>
      <QuizRunner definition={q.definition} slug={q.slug} orgName={q.orgName} embed={embed} fullscreen={fullscreen} publicUrl={publicUrl(q.slug)} />
    </div>
  );
}
