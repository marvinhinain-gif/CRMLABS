import type { Metadata } from "next";
import { getPublicForm } from "@/server/services/leads";
import { PublicLeadForm } from "@/components/public/PublicLeadForm";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = await getPublicForm((await params).slug);
  return { title: form ? `${form.headline} · ${form.orgName}` : "Formulário indisponível", robots: { index: false, follow: false } };
}

/** Página pública do formulário (destino do anúncio). Não exige login. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const form = await getPublicForm(slug);
  return (
    <div className="min-h-dvh bg-[#f2faf6]">
      <div aria-hidden className="pointer-events-none fixed -right-32 -top-32 size-[420px] rounded-full bg-[#dcf2e8]" />
      <div aria-hidden className="pointer-events-none fixed -left-40 bottom-[-160px] size-[460px] rounded-full bg-[#e3f5ec]" />
      <main className="relative mx-auto flex min-h-dvh max-w-[560px] flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-10">
        <div className="mb-6 flex justify-center">
          <AnimatedLogo size={30} />
        </div>
        {form ? (
          <PublicLeadForm form={form} />
        ) : (
          <div className="anim-rise rounded-[24px] bg-white p-8 text-center shadow-[0_10px_40px_rgb(16_60_48/0.08)]">
            <h1 className="text-[22px] font-bold">Formulário indisponível</h1>
            <p className="mt-2 text-[15px] text-muted">Este link não está mais ativo. Fale com quem enviou o anúncio.</p>
          </div>
        )}
        <p className="mt-auto pt-8 text-center text-[12px] text-muted">
          Seus dados são usados apenas para o contato desta equipe. <a href="/privacidade" className="underline">Privacidade</a>
        </p>
      </main>
    </div>
  );
}
