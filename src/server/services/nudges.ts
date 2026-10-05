import { and, eq, inArray } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { memberships, organizations, users } from "../db/schema";
import { logger } from "../logger";
import { notifyUser } from "./common";

/**
 * Mensagens das 9h e das 21h para social sellers e closers.
 * Curtas, ligadas à rotina comercial. Cada pessoa percorre a lista inteira antes de repetir.
 */
export const MORNING: { theme: string; text: string }[] = [
  { theme: "produtividade", text: "Novo dia, novas oportunidades. Organize seus contatos, priorize seus follow-ups e vamos buscar resultado." },
  { theme: "follow-up", text: "Comece pelos follow-ups de hoje: quem já demonstrou interesse merece a sua primeira mensagem." },
  { theme: "foco", text: "Escolha as três conversas mais importantes do dia e resolva-as antes do almoço." },
  { theme: "vendas", text: "Toda venda começa com uma boa pergunta. Hoje, escute mais do que fala." },
  { theme: "disciplina", text: "Abra o CRM, olhe suas tarefas e ataque a mais difícil primeiro. O resto fica leve." },
  { theme: "consistência", text: "Resultado é soma de dias bem feitos. Faça o de hoje contar." },
  { theme: "atendimento", text: "Responda rápido quem chegou ontem. Velocidade de resposta também vende." },
  { theme: "relacionamento", text: "Um bom dia sincero para quem está esfriando pode reabrir uma conversa. Vale tentar." },
  { theme: "execução", text: "Plano bom é plano executado. Defina a meta de contatos do dia e vá atrás dela." },
  { theme: "follow-up", text: "Tem lead esperando retorno? Hoje é o dia de dar o próximo passo com ele." },
  { theme: "produtividade", text: "Bloqueie um horário só para prospecção. Sem interrupções, o volume aparece." },
  { theme: "foco", text: "Menos abas abertas, mais conversas avançando. Foco no que move o funil." },
  { theme: "vendas", text: "Antes de oferecer, entenda a dor. Lead bem qualificado fecha mais fácil." },
  { theme: "disciplina", text: "Atualize o CRM a cada conversa. Amanhã você agradece." },
  { theme: "consistência", text: "Mesmo ritmo de ontem, com um contato a mais. É assim que o mês fecha bem." },
  { theme: "atendimento", text: "Trate cada lead como o único do dia. As pessoas sentem a diferença." },
  { theme: "relacionamento", text: "Lembre um detalhe da última conversa. Relacionamento é atenção." },
  { theme: "execução", text: "Reunião marcada é meio caminho. Confirme as de hoje logo cedo." },
  { theme: "follow-up", text: "A maioria das vendas sai depois do terceiro contato. Não pare no primeiro." },
  { theme: "produtividade", text: "Comece pelo que está atrasado. Zerar pendências libera energia para vender." },
  { theme: "foco", text: "Qual conversa, se avançar hoje, muda a sua semana? Comece por ela." },
  { theme: "vendas", text: "Objeção é pedido de mais informação. Esteja pronto para responder com calma." },
  { theme: "disciplina", text: "Defina horários para responder mensagens e cumpra. Constância gera confiança." },
  { theme: "consistência", text: "Pequenos avanços todos os dias valem mais que um grande esforço no fim do mês." },
  { theme: "atendimento", text: "Clareza vende: diga o próximo passo em toda conversa." },
  { theme: "relacionamento", text: "Quem indicou alguém merece um obrigado. Bom dia para fortalecer parcerias." },
  { theme: "execução", text: "Menos planejamento, mais ação: os primeiros contatos do dia ditam o ritmo." },
  { theme: "follow-up", text: "Revise quem sumiu nos últimos dias. Uma mensagem leve pode trazer de volta." },
  { theme: "vendas", text: "Hoje, conduza cada conversa até um compromisso: uma resposta, uma data, uma decisão." },
  { theme: "foco", text: "Notificações em silêncio por uma hora. Use esse tempo só para conversas que avançam." },
];

export const EVENING: { theme: string; text: string }[] = [
  { theme: "descanso", text: "O dia terminou. Descanse, recarregue e amanhã continuamos construindo resultados." },
  { theme: "reconhecimento", text: "Obrigado pelo empenho de hoje. Cada conversa conta para o resultado do time." },
  { theme: "preparação", text: "Antes de desligar, deixe as tarefas de amanhã no CRM. A manhã começa mais leve." },
  { theme: "equilíbrio", text: "Desconecte de verdade. Cabeça descansada vende melhor amanhã." },
  { theme: "evolução", text: "O que funcionou hoje? Guarde essa lição para repetir amanhã." },
  { theme: "consistência", text: "Mais um dia de trabalho bem feito. É a soma deles que constrói o mês." },
  { theme: "descanso", text: "Hora de pausar. Amanhã tem novas conversas esperando por você." },
  { theme: "reconhecimento", text: "Você fez a sua parte hoje. Reconheça o próprio esforço e descanse." },
  { theme: "preparação", text: "Confira as reuniões de amanhã e durma tranquilo sabendo o que vem." },
  { theme: "equilíbrio", text: "Trabalho bom também tem hora para acabar. Aproveite a sua noite." },
  { theme: "evolução", text: "Uma conversa difícil hoje é experiência para a próxima. Siga evoluindo." },
  { theme: "consistência", text: "Constância vence intensidade. Amanhã, o mesmo capricho de hoje." },
  { theme: "descanso", text: "Celular de lado, energia recarregando. Até amanhã!" },
  { theme: "reconhecimento", text: "Cada follow-up de hoje planta uma venda futura. Obrigado pela dedicação." },
  { theme: "preparação", text: "Deixe anotado o próximo passo de cada lead quente. Amanhã é só executar." },
  { theme: "equilíbrio", text: "Família, amigos, descanso: isso também faz parte de render bem." },
  { theme: "evolução", text: "Hoje você ficou um pouco melhor no que faz. Amanhã, mais um pouco." },
  { theme: "consistência", text: "Dia encerrado. O resultado do mês é construído exatamente assim." },
  { theme: "descanso", text: "Boa noite! Uma boa noite de sono é a melhor preparação para amanhã." },
  { theme: "reconhecimento", text: "O time avança porque cada um faz a sua parte. Obrigado pela sua hoje." },
  { theme: "preparação", text: "Amanhã cedo, comece pelos follow-ups. Hoje, apenas descanse." },
  { theme: "equilíbrio", text: "Resultado sustentável precisa de pausa. Aproveite o tempo livre." },
  { theme: "evolução", text: "Não deu tudo certo hoje? Normal. Amanhã é uma nova chance de ajustar." },
  { theme: "consistência", text: "Fechou o dia. Repetir o básico bem feito é o que traz o resultado." },
];

const g = globalThis as unknown as { __crmlabsNudgeCheck?: number };

function localParts(now: Date, tz: string) {
  const d = new TZDate(now.getTime(), tz);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { hour: d.getHours(), date, dayNumber: Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) };
}

function seed(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Mensagem do dia para a pessoa: muda todo dia e percorre o banco inteiro antes de repetir. */
export function pickMessage(kind: "morning" | "evening", userId: string, dayNumber: number) {
  const bank = kind === "morning" ? MORNING : EVENING;
  return bank[(dayNumber + seed(userId)) % bank.length];
}

/**
 * Envia bom dia (9h–11h59) e boa noite (21h–23h59) no fuso da organização.
 * A chave por dia garante uma única notificação de cada horário por pessoa, mesmo com o servidor reiniciando.
 */
export async function runDailyNudges(now = new Date()) {
  const orgs = await db.select({ id: organizations.id, tz: organizations.timezone }).from(organizations).where(eq(organizations.dailyNudges, true));
  let sent = 0;
  for (const org of orgs) {
    const { hour, date, dayNumber } = localParts(now, org.tz);
    const kind = hour >= 9 && hour < 12 ? "morning" : hour >= 21 ? "evening" : null;
    if (!kind) continue;
    const people = await db
      .select({ userId: memberships.userId, name: users.name, prefs: memberships.notifyPrefs })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, org.id), eq(memberships.status, "active"), inArray(memberships.role, ["seller", "closer"])));
    for (const p of people) {
      if (p.prefs?.daily === false) continue;
      const first = p.name.split(" ")[0];
      const msg = pickMessage(kind, p.userId, dayNumber);
      try {
        const created = await notifyUser({
          orgId: org.id,
          userId: p.userId,
          type: kind === "morning" ? "daily.morning" : "daily.evening",
          title: kind === "morning" ? `Bom dia, ${first}! 👋` : `Boa noite, ${first}! 🌙`,
          body: msg.text,
          link: kind === "morning" ? "/tarefas" : "/dashboard",
          dedupeKey: `daily:${kind}:${date}`,
        });
        if (created) sent++;
      } catch (e) {
        logger.warn("Falha ao criar mensagem diária", e);
      }
    }
  }
  return sent;
}

/** Chamado pelo processamento em segundo plano; checa no máximo uma vez por minuto. */
export async function scheduledNotificationsTick() {
  if (g.__crmlabsNudgeCheck && Date.now() - g.__crmlabsNudgeCheck < 60_000) return;
  g.__crmlabsNudgeCheck = Date.now();
  await runDailyNudges();
  const { taskReminders } = await import("./tasks");
  await taskReminders();
}
