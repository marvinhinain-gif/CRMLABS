"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowLeft, Eye, Inbox, ListChecks, Palette, Rocket, Save, Send, Settings2 } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { definitionSchema } from "@/lib/quiz/schema";
import type { QuizDefinition } from "@/lib/quiz/types";
import { Button, ErrorState, LoadingState, NoPermission, Sheet, SheetClose, Tabs } from "@/components/ui";
import { StatusBadge, type EditorOptions, type FormDetail } from "../shared";
import { AppearanceTab } from "./AppearanceTab";
import { Preview } from "./Preview";
import { PublishTab } from "./PublishTab";
import { QuestionsTab } from "./QuestionsTab";
import { SettingsTab, type Meta } from "./SettingsTab";

type Tab = "perguntas" | "aparencia" | "configuracoes" | "publicacao";

/** Primeiro erro de validação do rascunho, em linguagem simples (o servidor valida de novo). */
function draftError(d: QuizDefinition) {
  const r = definitionSchema.safeParse(d);
  if (r.success) return null;
  const issue = r.error.issues[0];
  return issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "Há um campo inválido. Confira cores, endereços e textos obrigatórios.";
}

export function FormEditor({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const allowed = me.permissions.forms;
  const { data: form, error, mutate } = useSWR<FormDetail>(allowed ? `/api/forms/${id}` : null, fetcher, { revalidateOnFocus: false });
  const { data: options } = useSWR<EditorOptions>(allowed ? "/api/forms/options" : null, fetcher, { revalidateOnFocus: false });
  const [tab, setTab] = useQueryParam("aba", "perguntas");
  const [draft, setDraft] = useState<QuizDefinition | null>(null);
  const [meta, setMetaState] = useState<Meta>({ name: "", slug: "" });
  const [domains, setDomainsState] = useState<string[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [slugError, setSlugError] = useState<string>();
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // Carrega o rascunho do servidor (ao abrir e depois de salvar/publicar).
  const hydrate = useCallback((f: FormDetail) => {
    setDraft(structuredClone(f.draft));
    setMetaState({ name: f.name, slug: f.slug });
    setDomainsState(f.allowedDomains);
    setBase(f.draftUpdatedAt);
    setDirty(false);
    setSlugError(undefined);
    loadedFor.current = f.id;
  }, []);
  useEffect(() => {
    if (form && loadedFor.current !== form.id) hydrate(form);
  }, [form, hydrate]);

  const update = useCallback((fn: (d: QuizDefinition) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const c = structuredClone(d);
      fn(c);
      return c;
    });
    setDirty(true);
  }, []);
  const setMeta = (m: Partial<Meta>) => {
    setMetaState((x) => ({ ...x, ...m }));
    if (m.slug !== undefined) setSlugError(undefined);
    setDirty(true);
  };
  const setDomains = (v: string[]) => {
    setDomainsState(v);
    setDirty(true);
  };

  const save = useCallback(
    async (quiet = false) => {
      if (!draft || !form) return null;
      const problem = draftError(draft);
      if (problem) {
        toast.error(problem);
        return null;
      }
      setSaving(true);
      try {
        const f = await api.patch<FormDetail>(`/api/forms/${form.id}`, { name: meta.name, slug: meta.slug, draft, allowedDomains: domains, baseUpdatedAt: base });
        await mutate(f, { revalidate: false });
        setBase(f.draftUpdatedAt);
        setMetaState({ name: f.name, slug: f.slug });
        setDomainsState(f.allowedDomains);
        setDirty(false);
        if (!quiet) toast.success("Rascunho salvo. O que está no ar só muda ao publicar.");
        return f;
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409 && /endereço/i.test(err.message)) setSlugError(err.message);
        else if (err.status === 422 && /Endereço/i.test(err.message)) setSlugError(err.message);
        if (err.status === 409 && !/endereço/i.test(err.message)) {
          toast.error(err.message, { action: { label: "Recarregar", onClick: () => mutate().then((f) => f && hydrate(f)) }, duration: 10000 });
        } else toast.error(err.message);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [draft, form, meta, domains, base, mutate, hydrate],
  );

  const publish = async () => {
    if (!form) return;
    setPublishing(true);
    try {
      if (dirty && !(await save(true))) return;
      const f = await api.post<FormDetail & { publishedVersion: number }>(`/api/forms/${form.id}/publish`);
      await mutate(f, { revalidate: false });
      setBase(f.draftUpdatedAt);
      toast.success(`Versão ${f.publishedVersion} publicada. O link já mostra esta versão.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };
  const unpublish = async () => {
    if (!form || !window.confirm("Despublicar? O link passa a mostrar “Formulário indisponível” até você publicar de novo.")) return;
    setPublishing(true);
    try {
      const f = await api.post<FormDetail>(`/api/forms/${form.id}/unpublish`);
      await mutate(f, { revalidate: false });
      toast.success("Formulário despublicado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  // Ctrl/Cmd+S salva; sair com alterações pede confirmação.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, save]);

  if (!allowed) return <NoPermission message="Formulários & Quizzes é gerenciado por administradores e gestores." />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!form || !options || !draft) return <LoadingState rows={6} />;

  const archived = form.status === "archived";
  const t = tab as Tab;
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="sticky top-[72px] z-20 -mx-4 -mt-6 lg:-mt-8 border-b border-line bg-page/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/formularios" aria-label="Voltar para formulários" title="Voltar" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-white hover:text-ink">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[20px] font-bold tracking-tight sm:text-[24px]">{meta.name || "Formulário"}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                <StatusBadge status={form.status} live={form.live} pending={form.hasUnpublishedChanges || dirty} />
                <span className={dirty ? "text-warning" : "text-muted"}>{saving ? "Salvando…" : dirty ? "Alterações não salvas" : "Rascunho salvo"}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:grow">
            <Button variant="secondary" size="sm" className="xl:hidden" icon={<Eye className="size-4" />} onClick={() => setPreviewOpen(true)}>
              Prévia
            </Button>
            <Button variant="secondary" size="sm" icon={<Inbox className="size-4" />} onClick={() => router.push(`/formularios/${form.id}/respostas`)}>
              Respostas
            </Button>
            <Button variant="secondary" size="sm" icon={<Save className="size-4" />} onClick={() => save()} loading={saving} disabled={!dirty || archived}>
              Salvar rascunho
            </Button>
            <Button size="sm" icon={<Rocket className="size-4" />} onClick={publish} loading={publishing} disabled={archived || (!dirty && !form.hasUnpublishedChanges && form.live)}>
              {form.live ? "Publicar alterações" : "Publicar"}
            </Button>
          </div>
        </div>
      </div>

      {archived && <p className="rounded-[16px] bg-[#eef2f1] px-4 py-3 text-[14px] text-[#3d4d56]">Este formulário está arquivado. Restaure-o na lista de formulários para editar ou publicar.</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<Tab>
            value={t}
            onChange={setTab}
            items={[
              { value: "perguntas", label: "Perguntas", icon: <ListChecks /> },
              { value: "aparencia", label: "Aparência", icon: <Palette /> },
              { value: "configuracoes", label: "Configurações", icon: <Settings2 /> },
              { value: "publicacao", label: "Publicação", icon: <Send /> },
            ]}
          />
          <fieldset disabled={archived} className="min-w-0">
            {t === "perguntas" && <QuestionsTab draft={draft} update={update} options={options} open={openQuestion} setOpen={setOpenQuestion} />}
            {t === "aparencia" && <AppearanceTab draft={draft} update={update} options={options} />}
            {t === "configuracoes" && <SettingsTab draft={draft} update={update} options={options} meta={meta} setMeta={setMeta} slugError={slugError} />}
            {t === "publicacao" && <PublishTab form={form} dirty={dirty} busy={publishing} onPublish={publish} onUnpublish={unpublish} domains={domains} setDomains={setDomains} />}
          </fieldset>
        </div>
        <aside className="hidden xl:block">
          <div className="sticky top-[170px]">
            <Preview formId={form.id} draft={draft} />
          </div>
        </aside>
      </div>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen} title="Prévia do formulário" width={480}>
        <div className="flex items-center justify-end px-4 pt-3">
          <SheetClose asChild>
            <Button size="sm" variant="ghost">
              Fechar
            </Button>
          </SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{previewOpen && <Preview formId={form.id} draft={draft} />}</div>
      </Sheet>
    </div>
  );
}
