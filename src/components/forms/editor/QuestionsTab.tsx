"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AtSign,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Copy,
  GitBranch,
  GripVertical,
  MoreHorizontal,
  ListChecks,
  ListFilter,
  Mail,
  Phone,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsUp,
  Trash2,
  Type,
} from "lucide-react";
import { questionMax, maxPoints, allQuestions } from "@/lib/quiz/engine";
import { uid } from "@/lib/quiz/templates";
import { CHOICE_TYPES, QUESTION_TYPE_LABEL, QUESTION_TYPES, type Condition, type ConditionOp, type CrmField, type QuestionType, type QuizDefinition, type QuizQuestion } from "@/lib/quiz/types";
import { Badge, Button, cx, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, Select, Switch, Textarea } from "@/components/ui";
import { ImagePicker, type EditorProps, type Update } from "./common";

const TYPE_ICON: Record<QuestionType, typeof Type> = {
  short_text: Type,
  long_text: AlignLeft,
  email: Mail,
  phone: Phone,
  url: AtSign,
  single_choice: CircleDot,
  multi_choice: ListChecks,
  dropdown: ListFilter,
  scale: SlidersHorizontal,
  date: CalendarDays,
  yes_no: ThumbsUp,
  consent: ShieldCheck,
};

const CRM_FIELDS: { value: CrmField; label: string }[] = [
  { value: "none", label: "Não enviar para um campo (fica nas respostas)" },
  { value: "name", label: "Nome do contato" },
  { value: "email", label: "E-mail do contato" },
  { value: "phone", label: "WhatsApp do contato" },
  { value: "instagram", label: "Instagram do contato" },
  { value: "company", label: "Empresa" },
];

const OP_LABEL: Record<ConditionOp, string> = {
  equals: "é igual a",
  not_equals: "é diferente de",
  includes: "inclui",
  not_includes: "não inclui",
  answered: "foi respondida",
  gte: "é maior ou igual a",
  lte: "é menor ou igual a",
};

function opsFor(t: QuestionType): ConditionOp[] {
  if (t === "multi_choice") return ["includes", "not_includes", "answered"];
  if (CHOICE_TYPES.includes(t)) return ["equals", "not_equals", "answered"];
  if (t === "scale") return ["gte", "lte", "equals", "answered"];
  return ["answered", "equals", "not_equals"];
}

/** Ajusta campos ao trocar o tipo da pergunta. */
function retype(q: QuizQuestion, type: QuestionType): QuizQuestion {
  const next: QuizQuestion = { ...q, type };
  if (CHOICE_TYPES.includes(type)) {
    if (type === "yes_no") next.options = [{ id: uid("o"), label: "Sim", points: 0 }, { id: uid("o"), label: "Não", points: 0 }];
    else if (!q.options?.length || q.type === "yes_no") next.options = [{ id: uid("o"), label: "Alternativa 1", points: 0 }, { id: uid("o"), label: "Alternativa 2", points: 0 }];
    next.scale = undefined;
  } else {
    next.options = undefined;
    next.maxPoints = null;
  }
  if (type === "scale") next.scale = q.scale ?? { min: 0, max: 10, minLabel: "Nada provável", maxLabel: "Muito provável", pointsPerStep: 0 };
  if (!CHOICE_TYPES.includes(type) && type !== "scale") next.scored = false;
  if (type === "consent") {
    next.crmField = "none";
    next.title = q.title || "Concordo com os termos";
  }
  const auto: Partial<Record<QuestionType, CrmField>> = { email: "email", phone: "phone" };
  if (auto[type] && q.crmField === "none") next.crmField = auto[type]!;
  return next;
}

function newQuestion(type: QuestionType): QuizQuestion {
  return retype({ id: uid("q"), type: "short_text", title: "", description: null, placeholder: null, required: true, imageAssetId: null, scored: false, crmField: "none", showIf: null }, type);
}

// ---------- Item ordenável ----------

function SortableQuestion({ q, children }: { q: QuizQuestion; children: (handle: { attributes: object; listeners: object | undefined }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, opacity: isDragging ? 0.85 : 1 };
  return (
    <li ref={setNodeRef} style={style} className={cx(isDragging && "shadow-[var(--shadow-pop)] rounded-[18px]")}>
      {children({ attributes, listeners })}
    </li>
  );
}

function SectionDrop({ id, children, empty }: { id: string; children: React.ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${id}` });
  return (
    <ul ref={setNodeRef} className={cx("flex flex-col gap-2.5 rounded-[18px] transition-colors", empty && "min-h-16 border-2 border-dashed border-line p-2", isOver && "bg-selected/50")}>
      {children}
    </ul>
  );
}

// ---------- Editor de uma pergunta ----------

function QuestionEditor({ q, index, all, update, options, scoringOn, normalize, total }: { q: QuizQuestion; index: number; all: QuizQuestion[]; update: (fn: (q: QuizQuestion) => void) => void; options: EditorProps["options"]; scoringOn: boolean; normalize: boolean; total: number }) {
  const [newKey, setNewKey] = useState("");
  const isChoice = CHOICE_TYPES.includes(q.type);
  const previous = all.slice(0, index);
  const customKeys = options.customFields;
  const crmValue = q.crmField.startsWith("custom:") && !customKeys.some((c) => `custom:${c.key}` === q.crmField) ? "__new" : q.crmField;
  const max = questionMax(q);

  return (
    <div className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <Field label="Pergunta" htmlFor={`t-${q.id}`}>
          <Input id={`t-${q.id}`} value={q.title} onChange={(e) => update((x) => void (x.title = e.target.value))} placeholder="Escreva a pergunta" maxLength={300} />
        </Field>
        <Field label="Tipo" htmlFor={`ty-${q.id}`}>
          <Select id={`ty-${q.id}`} value={q.type} onChange={(e) => update((x) => Object.assign(x, retype(x, e.target.value as QuestionType)))}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Descrição (opcional)" htmlFor={`d-${q.id}`}>
        <Textarea id={`d-${q.id}`} className="min-h-[60px]" value={q.description ?? ""} onChange={(e) => update((x) => void (x.description = e.target.value || null))} placeholder="Ajuda ou contexto para quem responde" maxLength={1000} />
      </Field>
      {["short_text", "long_text", "email", "phone", "url"].includes(q.type) && (
        <Field label="Texto de exemplo no campo" htmlFor={`p-${q.id}`}>
          <Input id={`p-${q.id}`} value={q.placeholder ?? ""} onChange={(e) => update((x) => void (x.placeholder = e.target.value || null))} maxLength={120} />
        </Field>
      )}

      {/* Alternativas */}
      {isChoice && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-medium">Alternativas</span>
            {q.scored && scoringOn && <span className="text-[12.5px] text-muted">Pontos por alternativa</span>}
          </div>
          <ul className="flex flex-col gap-2">
            {(q.options ?? []).map((o, oi) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-[12.5px] text-muted">{String.fromCharCode(65 + (oi % 26))}</span>
                <Input
                  aria-label={`Alternativa ${oi + 1}`}
                  value={o.label}
                  maxLength={200}
                  onChange={(e) => update((x) => void (x.options![oi].label = e.target.value))}
                  className="min-w-0"
                />
                {q.scored && scoringOn && (
                  <Input
                    aria-label={`Pontos da alternativa ${oi + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={-100}
                    max={100}
                    value={o.points}
                    onChange={(e) => update((x) => void (x.options![oi].points = Math.max(-100, Math.min(100, Math.round(Number(e.target.value) || 0)))))}
                    className="w-20 text-right"
                  />
                )}
                <div className="flex shrink-0">
                  <IconButton size="sm" label="Subir alternativa" disabled={oi === 0} onClick={() => update((x) => void x.options!.splice(oi - 1, 0, x.options!.splice(oi, 1)[0]))}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton size="sm" label="Descer alternativa" disabled={oi === (q.options?.length ?? 0) - 1} onClick={() => update((x) => void x.options!.splice(oi + 1, 0, x.options!.splice(oi, 1)[0]))}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton size="sm" label="Remover alternativa" disabled={(q.options?.length ?? 0) <= 2} onClick={() => update((x) => void x.options!.splice(oi, 1))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
          {q.type !== "yes_no" && (q.options?.length ?? 0) < 30 && (
            <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-4" />} onClick={() => update((x) => void x.options!.push({ id: uid("o"), label: `Alternativa ${(x.options?.length ?? 0) + 1}`, points: 0 }))}>
              Adicionar alternativa
            </Button>
          )}
          {q.type === "multi_choice" && q.scored && scoringOn && (
            <Field label="Teto de pontos desta pergunta (opcional)" htmlFor={`mx-${q.id}`} hint="Limita a soma quando a pessoa marca várias alternativas.">
              <Input id={`mx-${q.id}`} type="number" min={0} max={100} value={q.maxPoints ?? ""} onChange={(e) => update((x) => void (x.maxPoints = e.target.value === "" ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))))))} className="w-32" />
            </Field>
          )}
        </div>
      )}

      {/* Escala */}
      {q.type === "scale" && q.scale && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="De" htmlFor={`smin-${q.id}`}>
            <Input id={`smin-${q.id}`} type="number" min={0} max={10} value={q.scale.min} onChange={(e) => update((x) => void (x.scale!.min = Math.max(0, Math.min(10, Number(e.target.value) || 0))))} />
          </Field>
          <Field label="Até" htmlFor={`smax-${q.id}`}>
            <Input id={`smax-${q.id}`} type="number" min={1} max={10} value={q.scale.max} onChange={(e) => update((x) => void (x.scale!.max = Math.max(1, Math.min(10, Number(e.target.value) || 1))))} />
          </Field>
          <Field label="Rótulo do início" htmlFor={`sminl-${q.id}`}>
            <Input id={`sminl-${q.id}`} value={q.scale.minLabel ?? ""} maxLength={60} onChange={(e) => update((x) => void (x.scale!.minLabel = e.target.value || null))} />
          </Field>
          <Field label="Rótulo do fim" htmlFor={`smaxl-${q.id}`}>
            <Input id={`smaxl-${q.id}`} value={q.scale.maxLabel ?? ""} maxLength={60} onChange={(e) => update((x) => void (x.scale!.maxLabel = e.target.value || null))} />
          </Field>
          {q.scored && scoringOn && (
            <Field label="Pontos por passo" htmlFor={`sps-${q.id}`} className="sm:col-span-2">
              <Input id={`sps-${q.id}`} type="number" min={0} max={20} step="0.5" value={q.scale.pointsPerStep} onChange={(e) => update((x) => void (x.scale!.pointsPerStep = Math.max(0, Math.min(20, Number(e.target.value) || 0))))} />
            </Field>
          )}
        </div>
      )}

      <ImagePicker kind="image" label="Imagem da pergunta (opcional)" value={q.imageAssetId} onChange={(id) => update((x) => void (x.imageAssetId = id))} />

      <div className="grid gap-x-6 sm:grid-cols-2">
        <Switch label="Obrigatória" checked={q.required} onChange={(v) => update((x) => void (x.required = v))} description={q.type === "consent" ? "A pessoa precisa marcar para enviar." : undefined} />
        {(isChoice || q.type === "scale") && (
          <Switch
            label="Conta no Lead Score"
            checked={q.scored}
            disabled={!scoringOn}
            onChange={(v) => update((x) => void (x.scored = v))}
            description={!scoringOn ? "Ligue o Lead Score em Configurações." : q.scored ? `Vale até ${max} ponto${max === 1 ? "" : "s"}${normalize && total ? ` (${Math.round((max / total) * 100)}% do score)` : ""}.` : undefined}
          />
        )}
      </div>

      {q.type !== "consent" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Salvar no CRM como" htmlFor={`crm-${q.id}`} hint="Atualiza o contato e o lead criados a partir da resposta.">
            <Select
              id={`crm-${q.id}`}
              value={crmValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new") update((x) => void (x.crmField = `custom:${(newKey || x.id).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`));
                else update((x) => void (x.crmField = v as CrmField));
              }}
            >
              {CRM_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
              {customKeys.length > 0 && (
                <optgroup label="Campos personalizados">
                  {customKeys.map((c) => (
                    <option key={c.key} value={`custom:${c.key}`}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="__new">Novo campo personalizado…</option>
            </Select>
          </Field>
          {crmValue === "__new" && (
            <Field label="Chave do novo campo" htmlFor={`ck-${q.id}`} hint="Letras minúsculas, números e _. O campo é criado ao publicar.">
              <Input
                id={`ck-${q.id}`}
                value={q.crmField.slice(7) || newKey}
                maxLength={40}
                onChange={(e) => {
                  const k = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
                  setNewKey(k);
                  update((x) => void (x.crmField = `custom:${k || x.id.replace(/[^a-z0-9_]/g, "_")}`));
                }}
              />
            </Field>
          )}
        </div>
      )}

      <ConditionEditor q={q} previous={previous} update={update} />
    </div>
  );
}

function ConditionEditor({ q, previous, update }: { q: QuizQuestion; previous: QuizQuestion[]; update: (fn: (q: QuizQuestion) => void) => void }) {
  const cond = q.showIf;
  const candidates = previous.filter((p) => p.type !== "consent");
  if (!cond) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        icon={<GitBranch className="size-4" />}
        disabled={!candidates.length}
        title={!candidates.length ? "Só perguntas que vêm depois de outra podem ter condição." : undefined}
        onClick={() => {
          const base = candidates[candidates.length - 1];
          update((x) => void (x.showIf = { mode: "all", conditions: [{ questionId: base.id, op: opsFor(base.type)[0], value: base.options?.[0]?.id ?? null }] }));
        }}
      >
        Mostrar só se… (lógica condicional)
      </Button>
    );
  }
  const setCond = (i: number, c: Partial<Condition>) => update((x) => void Object.assign(x.showIf!.conditions[i], c));
  return (
    <div className="rounded-[16px] border border-[#c9ebdc] bg-selected/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13.5px]">
        <GitBranch className="size-4 text-brand" aria-hidden />
        <span className="font-medium">Mostrar esta pergunta quando</span>
        <Select aria-label="Combinar condições" value={cond.mode} onChange={(e) => update((x) => void (x.showIf!.mode = e.target.value as "all" | "any"))} className="h-9 w-auto text-[13.5px]">
          <option value="all">todas as condições</option>
          <option value="any">qualquer condição</option>
        </Select>
        <span>forem verdadeiras:</span>
      </div>
      <ul className="flex flex-col gap-2">
        {cond.conditions.map((c, i) => {
          const src = candidates.find((p) => p.id === c.questionId);
          const ops = src ? opsFor(src.type) : (["answered"] as ConditionOp[]);
          return (
            <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label="Pergunta"
                value={c.questionId}
                onChange={(e) => {
                  const p = candidates.find((x) => x.id === e.target.value)!;
                  setCond(i, { questionId: p.id, op: opsFor(p.type)[0], value: p.options?.[0]?.id ?? null });
                }}
                className="h-9 text-[13.5px] sm:w-[40%]"
              >
                {!src && <option value={c.questionId}>Pergunta removida</option>}
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || "Pergunta sem texto"}
                  </option>
                ))}
              </Select>
              <Select aria-label="Operador" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })} className="h-9 text-[13.5px] sm:w-44">
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </Select>
              {c.op !== "answered" &&
                (src?.options ? (
                  <Select aria-label="Valor" value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })} className="h-9 min-w-0 flex-1 text-[13.5px]">
                    {src.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    aria-label="Valor"
                    type={src?.type === "scale" ? "number" : "text"}
                    value={c.value ?? ""}
                    onChange={(e) => setCond(i, { value: src?.type === "scale" ? Number(e.target.value) : e.target.value })}
                    className="h-9 min-w-0 flex-1 text-[13.5px]"
                  />
                ))}
              <IconButton size="sm" label="Remover condição" onClick={() => update((x) => (x.showIf!.conditions.length === 1 ? void (x.showIf = null) : void x.showIf!.conditions.splice(i, 1)))}>
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {cond.conditions.length < 10 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          icon={<Plus className="size-4" />}
          onClick={() => {
            const base = candidates[candidates.length - 1];
            update((x) => void x.showIf!.conditions.push({ questionId: base.id, op: opsFor(base.type)[0], value: base.options?.[0]?.id ?? null }));
          }}
        >
          Adicionar condição
        </Button>
      )}
    </div>
  );
}

// ---------- Aba ----------

function AddQuestionMenu({ onAdd, label = "Adicionar pergunta" }: { onAdd: (t: QuestionType) => void; label?: string }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="soft" icon={<Plus className="size-4" />}>
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
        {QUESTION_TYPES.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <MenuItem key={t} icon={<Icon />} onSelect={() => onAdd(t)}>
              {QUESTION_TYPE_LABEL[t]}
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

function findQuestion(d: QuizDefinition, id: string) {
  for (const s of d.sections) {
    const i = s.questions.findIndex((q) => q.id === id);
    if (i >= 0) return { section: s, index: i };
  }
  return null;
}

export function QuestionsTab({ draft, update, options, open, setOpen }: EditorProps & { open: string | null; setOpen: (id: string | null) => void }) {
  const all = useMemo(() => allQuestions(draft), [draft]);
  const total = maxPoints(draft);
  const scoringOn = draft.scoring.enabled;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    update((d) => {
      const from = findQuestion(d, activeId);
      if (!from) return;
      const [moved] = from.section.questions.splice(from.index, 1);
      if (overId.startsWith("section:")) {
        d.sections.find((s) => s.id === overId.slice(8))?.questions.push(moved);
        return;
      }
      const to = findQuestion(d, overId);
      if (!to) return from.section.questions.splice(from.index, 0, moved), undefined;
      // Arrastando para baixo na mesma seção, entra depois do alvo.
      const after = to.section === from.section && from.index <= to.index;
      to.section.questions.splice(after ? to.index + 1 : to.index, 0, moved);
    });
  };

  const addQuestion = (sectionId: string, t: QuestionType) => {
    const q = newQuestion(t);
    update((d) => void d.sections.find((s) => s.id === sectionId)?.questions.push(q));
    setOpen(q.id);
  };

  const qUpdate = (id: string) => (fn: (q: QuizQuestion) => void) =>
    update((d) => {
      const f = findQuestion(d, id);
      if (f) fn(f.section.questions[f.index]);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-white px-4 py-3 text-[13.5px]">
        <span className="text-muted">
          <b className="text-ink">{all.length}</b> pergunta{all.length === 1 ? "" : "s"} em <b className="text-ink">{draft.sections.length}</b> etapa{draft.sections.length === 1 ? "" : "s"}
        </span>
        {scoringOn ? (
          <span className="text-muted">
            Pontuação máxima: <b className="text-ink">{total} pontos</b>
            {draft.scoring.normalize && total !== 100 && total > 0 && " · convertida para 0–100"}
          </span>
        ) : (
          <span className="text-muted">Lead Score desligado</span>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: "Pressione espaço para pegar a pergunta, setas para mover e espaço para soltar. Esc cancela." } }}>
        {draft.sections.map((sec, si) => (
          <section key={sec.id} className="rounded-[var(--radius-card)] border border-line/70 bg-card p-3 shadow-[var(--shadow-soft)] sm:p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start">
              <span className="mt-2 shrink-0 rounded-full bg-selected px-2.5 py-1 text-[12px] font-semibold text-brand">Etapa {si + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input aria-label={`Título da etapa ${si + 1}`} value={sec.title} maxLength={160} placeholder="Título da etapa" onChange={(e) => update((d) => void (d.sections[si].title = e.target.value))} className="font-semibold" />
                <Input aria-label={`Descrição da etapa ${si + 1}`} value={sec.description ?? ""} maxLength={600} placeholder="Descrição (opcional)" onChange={(e) => update((d) => void (d.sections[si].description = e.target.value || null))} className="h-9 text-[13.5px]" />
              </div>
              <div className="flex shrink-0 justify-end">
                <IconButton size="sm" label="Subir etapa" disabled={si === 0} onClick={() => update((d) => void d.sections.splice(si - 1, 0, d.sections.splice(si, 1)[0]))}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton size="sm" label="Descer etapa" disabled={si === draft.sections.length - 1} onClick={() => update((d) => void d.sections.splice(si + 1, 0, d.sections.splice(si, 1)[0]))}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton
                  size="sm"
                  label="Excluir etapa"
                  disabled={draft.sections.length <= 1}
                  onClick={() => {
                    if (sec.questions.length && !window.confirm(`Excluir a etapa "${sec.title || si + 1}" e as ${sec.questions.length} perguntas dela?`)) return;
                    update((d) => void d.sections.splice(si, 1));
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
            <SortableContext items={sec.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <SectionDrop id={sec.id} empty={!sec.questions.length}>
                {!sec.questions.length && <li className="py-3 text-center text-[13px] text-muted">Arraste uma pergunta para cá ou adicione uma nova.</li>}
                {sec.questions.map((q) => {
                  const idx = all.findIndex((x) => x.id === q.id);
                  const Icon = TYPE_ICON[q.type];
                  const isOpen = open === q.id;
                  const pts = questionMax(q);
                  return (
                    <SortableQuestion key={q.id} q={q}>
                      {({ attributes, listeners }) => (
                        <div className={cx("rounded-[18px] border bg-white transition-colors", isOpen ? "border-brand/60 ring-4 ring-[#008a65]/10" : "border-line")}>
                          <div className="flex items-center gap-1.5 p-2 pr-1">
                            <button type="button" className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-[10px] text-muted hover:bg-page active:cursor-grabbing" aria-label={`Arrastar pergunta ${idx + 1}`} {...attributes} {...listeners}>
                              <GripVertical className="size-4" />
                            </button>
                            <button type="button" onClick={() => setOpen(isOpen ? null : q.id)} className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left" aria-expanded={isOpen}>
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-selected text-brand">
                                <Icon className="size-4" aria-hidden />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-medium text-ink">
                                  {idx + 1}. {q.title || <span className="text-muted">Pergunta sem texto</span>}
                                </span>
                                <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px]">
                                  <span className="text-muted">{QUESTION_TYPE_LABEL[q.type]}</span>
                                  {q.required && <span className="text-muted">· Obrigatória</span>}
                                  {q.scored && scoringOn && <span className="font-medium text-brand">· {pts} pts</span>}
                                  {q.showIf && <span className="text-info">· Condicional</span>}
                                  {q.crmField !== "none" && <span className="text-muted">· CRM</span>}
                                </span>
                              </span>
                              <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", isOpen && "rotate-180")} aria-hidden />
                            </button>
                            <Menu>
                              <MenuTrigger asChild>
                                <IconButton size="sm" label="Ações da pergunta">
                                  <MoreHorizontal className="size-4" />
                                </IconButton>
                              </MenuTrigger>
                              <MenuContent>
                                <MenuItem
                                  icon={<Copy />}
                                  onSelect={() => {
                                    const copy = { ...structuredClone(q), id: uid("q"), title: `${q.title} (cópia)`, options: q.options?.map((o) => ({ ...o, id: uid("o") })) };
                                    update((d) => {
                                      const f = findQuestion(d, q.id);
                                      f?.section.questions.splice(f.index + 1, 0, copy);
                                    });
                                    setOpen(copy.id);
                                  }}
                                >
                                  Duplicar
                                </MenuItem>
                                {draft.sections
                                  .filter((s) => s.id !== sec.id)
                                  .map((s) => (
                                    <MenuItem
                                      key={s.id}
                                      icon={<ArrowDown />}
                                      onSelect={() =>
                                        update((d) => {
                                          const f = findQuestion(d, q.id);
                                          if (!f) return;
                                          const [m] = f.section.questions.splice(f.index, 1);
                                          d.sections.find((x) => x.id === s.id)?.questions.push(m);
                                        })
                                      }
                                    >
                                      Mover para “{s.title || "etapa sem título"}”
                                    </MenuItem>
                                  ))}
                                <MenuItem
                                  icon={<Trash2 />}
                                  danger
                                  onSelect={() => {
                                    const deps = all.filter((x) => x.showIf?.conditions.some((c) => c.questionId === q.id));
                                    const reqs = draft.scoring.tiers.flatMap((t) => t.requirements.filter((r) => r.questionId === q.id));
                                    const warn = [deps.length ? `${deps.length} pergunta(s) dependem dela` : "", reqs.length ? `${reqs.length} requisito(s) de classificação usam ela` : ""].filter(Boolean).join(" e ");
                                    if (!window.confirm(`Excluir "${q.title || "pergunta"}"?${warn ? ` Atenção: ${warn}.` : ""} Respostas já recebidas continuam guardadas.`)) return;
                                    update((d) => {
                                      const f = findQuestion(d, q.id);
                                      f?.section.questions.splice(f.index, 1);
                                      for (const x of allQuestions(d)) {
                                        if (!x.showIf) continue;
                                        x.showIf.conditions = x.showIf.conditions.filter((c) => c.questionId !== q.id);
                                        if (!x.showIf.conditions.length) x.showIf = null;
                                      }
                                      for (const t of d.scoring.tiers) t.requirements = t.requirements.filter((r) => r.questionId !== q.id);
                                    });
                                  }}
                                >
                                  Excluir
                                </MenuItem>
                              </MenuContent>
                            </Menu>
                          </div>
                          {isOpen && <QuestionEditor q={q} index={idx} all={all} update={qUpdate(q.id)} options={options} scoringOn={scoringOn} normalize={draft.scoring.normalize} total={total} />}
                        </div>
                      )}
                    </SortableQuestion>
                  );
                })}
              </SectionDrop>
            </SortableContext>
            <div className="mt-3">
              <AddQuestionMenu onAdd={(t) => addQuestion(sec.id, t)} />
            </div>
          </section>
        ))}
      </DndContext>
      {draft.sections.length < 20 && (
        <Button variant="secondary" className="self-start" icon={<Plus className="size-4" />} onClick={() => update((d) => void d.sections.push({ id: uid("s"), title: `Etapa ${d.sections.length + 1}`, description: null, questions: [] }))}>
          Adicionar etapa
        </Button>
      )}
      {scoringOn && total > 0 && <ScoreTable draft={draft} total={total} />}
    </div>
  );
}

function ScoreTable({ draft, total }: { draft: QuizDefinition; total: number }) {
  const scored = allQuestions(draft).filter((q) => q.scored);
  return (
    <details className="rounded-[18px] border border-line bg-white p-4">
      <summary className="cursor-pointer text-[14px] font-semibold">Resumo dos pesos ({total} pontos)</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {scored.map((q) => {
          const m = questionMax(q);
          return (
            <li key={q.id} className="flex items-center justify-between gap-3 text-[13.5px]">
              <span className="truncate">{q.title}</span>
              <span className="shrink-0">
                <Badge tone="brand">{m} pts</Badge>
                {draft.scoring.normalize && total !== 100 && <span className="ml-2 text-muted">≈ {Math.round((m / total) * 100)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {draft.scoring.normalize && total !== 100 && (
        <p className="mt-3 text-[12.5px] text-muted">O total não soma 100, então o score é convertido proporcionalmente para 0–100 (pontos ÷ {total} × 100). As faixas usam o valor convertido.</p>
      )}
    </details>
  );
}

export type { Update };
