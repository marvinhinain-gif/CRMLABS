import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Termos de Serviço" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Logo size={30} />
      <h1 className="mt-10 text-[28px] font-bold">Termos de Serviço</h1>
      <p className="mt-2 text-[14px] text-[#5b6b73]">Última atualização: 28 de outubro de 2026</p>
      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-[#33444d]">
        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">1. O serviço</h2>
        <p>O CRMLABS é um CRM de uso interno da equipe da Axion Co. para organizar relacionamentos, atendimento, oportunidades comerciais e agendamentos de reuniões. O acesso é feito somente por convite da organização.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">2. Conta e acesso</h2>
        <p>Cada usuário é responsável por manter sua senha em segurança e pelo uso feito com a sua conta. O administrador da organização pode conceder, alterar ou remover acessos a qualquer momento.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">3. Uso permitido</h2>
        <p>O CRMLABS deve ser usado apenas para atividades legítimas da organização. Não é permitido usar o serviço para enviar spam, violar direitos de terceiros, acessar dados sem autorização ou tentar comprometer a segurança do sistema.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">4. Integrações</h2>
        <p>Algumas funções dependem de serviços de terceiros, como Google Agenda e Instagram. Ao conectar essas contas, você autoriza o CRMLABS a usá-las somente para as funções descritas na <a className="underline" href="/privacidade">Política de Privacidade</a>, e pode revogar a autorização quando quiser.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">5. Dados</h2>
        <p>O tratamento de dados pessoais segue a <a className="underline" href="/privacidade">Política de Privacidade</a> e a Lei Geral de Proteção de Dados (LGPD).</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">6. Disponibilidade</h2>
        <p>Trabalhamos para manter o CRMLABS disponível e seguro, mas o serviço é oferecido no estado em que se encontra e pode passar por manutenções, mudanças ou interrupções.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">7. Alterações</h2>
        <p>Estes termos podem ser atualizados. A data da última atualização fica indicada no topo desta página.</p>

        <h2 className="mt-4 text-[18px] font-bold text-[#11222b]">8. Contato</h2>
        <p>Dúvidas sobre estes termos: marvinhinain@gmail.com</p>
      </div>
    </main>
  );
}
