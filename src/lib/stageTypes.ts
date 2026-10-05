/** Significado das etapas comerciais (o nome da coluna é livre; o tipo mantém as métricas certas). */
export const STAGE_TYPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "entry", label: "Entrada de lead", hint: "Onde o lead encaminhado pelo social seller chega." },
  { value: "contacted", label: "Contato realizado", hint: "Conta como contato realizado." },
  { value: "scheduled", label: "Reunião agendada", hint: "Ao entrar, o CRM sugere marcar a reunião." },
  { value: "meeting_done", label: "Reunião realizada", hint: "Marca a reunião como realizada." },
  { value: "follow_up", label: "Follow-up", hint: "Acompanhamento depois da reunião." },
  { value: "negotiation", label: "Negociação", hint: "Proposta e negociação." },
  { value: "won", label: "Venda ganha", hint: "Registra a venda e o valor." },
  { value: "lost", label: "Venda perdida", hint: "Registra a perda e o motivo." },
  { value: "custom", label: "Outra (sem efeito nas métricas)", hint: "Etapa livre do seu processo." },
];
export const STAGE_TYPE_LABEL: Record<string, string> = Object.fromEntries(STAGE_TYPE_OPTIONS.map((o) => [o.value, o.label]));
