import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Privacidade e exclusão de dados" };

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Logo size={30} />
      <h1 className="mt-10 text-[28px] font-bold">Privacidade e exclusão de dados</h1>
      {pedido && (
        <p className="mt-4 rounded-[16px] bg-selected p-4 text-[14.5px]">
          Pedido de exclusão recebido. Código de confirmação: <strong>{pedido}</strong>. As credenciais de acesso foram removidas imediatamente.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-[#33444d]">
        <p>O CRMLABS é usado pela equipe da organização para organizar relacionamentos e atendimento. Dados recebidos do Instagram (mensagens, comentários e identificadores) são acessados apenas pela API oficial da Meta, com autorização do administrador da conta profissional.</p>
        <p>Ao revogar o acesso no Instagram ou solicitar a exclusão, o CRMLABS apaga os tokens de acesso, interrompe o recebimento de eventos e o envio de mensagens. Os registros já existentes seguem a política de retenção configurada pela organização e podem ser excluídos mediante solicitação ao administrador.</p>
        <p>Notas internas nunca são enviadas ao Instagram. Senhas do Instagram nunca são solicitadas.</p>
      </div>
    </main>
  );
}
