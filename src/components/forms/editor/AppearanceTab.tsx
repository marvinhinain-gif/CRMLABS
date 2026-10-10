"use client";

import { Check } from "lucide-react";
import { APPEARANCE_PRESETS } from "@/lib/quiz/templates";
import type { Appearance } from "@/lib/quiz/types";
import { cx, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { ImagePicker, Panel, type EditorProps } from "./common";

const PRESET_CARDS = [
  { key: "clean", label: "Branco minimalista", hint: "Padrão: Poppins, fundo branco e verde CRMLABS." },
  { key: "dark", label: "Escuro", hint: "Fundo escuro com destaque em verde." },
  { key: "custom", label: "Personalizado", hint: "Suas cores e tipografia." },
] as const;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="size-11 shrink-0 cursor-pointer rounded-[12px] border border-line bg-white p-1" />
        <Input
          aria-label={`${label} (hexadecimal)`}
          value={value}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            if (/^#[0-9a-f]{0,6}$/i.test(v)) onChange(v.toLowerCase());
          }}
          invalid={!/^#[0-9a-f]{6}$/i.test(value)}
          className="font-mono"
        />
      </div>
    </Field>
  );
}

export function AppearanceTab({ draft, update }: EditorProps) {
  const a = draft.appearance;
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K], custom = true) =>
    update((d) => {
      d.appearance[k] = v;
      if (custom && ["primary", "secondary", "background", "text", "font"].includes(k)) d.appearance.preset = "custom";
    });
  const applyPreset = (p: "clean" | "dark" | "custom") =>
    update((d) => {
      if (p === "custom") d.appearance.preset = "custom";
      else Object.assign(d.appearance, APPEARANCE_PRESETS[p]);
    });

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Tema" description="Comece por um modelo e ajuste o que quiser.">
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
          {PRESET_CARDS.map((p) => {
            const active = a.preset === p.key;
            const sw = p.key === "custom" ? a : APPEARANCE_PRESETS[p.key];
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => applyPreset(p.key)}
                className={cx("relative flex flex-col gap-2 rounded-[18px] border p-3 text-left transition-colors", active ? "border-brand ring-4 ring-[#008a65]/10" : "border-line hover:bg-page")}
              >
                <span className="flex h-14 items-end gap-1.5 rounded-[12px] border border-line/60 p-2" style={{ background: sw.background }}>
                  <span className="h-2 w-12 rounded-full" style={{ background: sw.text, opacity: 0.8 }} />
                  <span className="ml-auto h-6 w-12 rounded-[8px]" style={{ background: sw.primary }} />
                </span>
                <span className="text-[14px] font-semibold">{p.label}</span>
                <span className="text-[12.5px] text-muted">{p.hint}</span>
                {active && (
                  <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="size-4" aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Cores e tipografia">
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField label="Cor principal (botões)" value={a.primary} onChange={(v) => set("primary", v)} />
          <ColorField label="Cor de destaque (seleção)" value={a.secondary} onChange={(v) => set("secondary", v)} />
          <ColorField label="Fundo" value={a.background} onChange={(v) => set("background", v)} />
          <ColorField label="Texto" value={a.text} onChange={(v) => set("text", v)} />
          <Field label="Tipografia" htmlFor="ap-font">
            <Select id="ap-font" value={a.font} onChange={(e) => set("font", e.target.value as Appearance["font"])}>
              <option value="poppins">Poppins (padrão)</option>
              <option value="system">Sistema (leve e rápida)</option>
              <option value="rounded">Arredondada</option>
              <option value="serif">Serifada (editorial)</option>
            </Select>
          </Field>
          <Field label="Estilo dos botões" htmlFor="ap-btn">
            <Select id="ap-btn" value={a.buttonStyle} onChange={(e) => set("buttonStyle", e.target.value as Appearance["buttonStyle"], false)}>
              <option value="solid">Preenchido</option>
              <option value="outline">Contorno</option>
              <option value="pill">Pílula</option>
            </Select>
          </Field>
          <Field label={`Arredondamento das bordas: ${a.radius}px`} htmlFor="ap-radius" className="sm:col-span-2">
            <input id="ap-radius" type="range" min={0} max={32} step={2} value={a.radius} onChange={(e) => set("radius", Number(e.target.value), false)} className="w-full accent-[#008a65]" />
          </Field>
        </div>
      </Panel>

      <Panel title="Imagens">
        <div className="grid gap-5 sm:grid-cols-2">
          <ImagePicker kind="logo" label="Logo" value={a.logoAssetId} onChange={(id) => set("logoAssetId", id, false)} hint="Sem logo, mostramos o nome da empresa." />
          <ImagePicker kind="cover" label="Capa" value={a.coverAssetId} onChange={(id) => set("coverAssetId", id, false)} hint="Aparece na tela de boas-vindas." />
        </div>
      </Panel>

      <Panel title="Experiência">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Como mostrar as perguntas" htmlFor="ap-layout">
            <Select id="ap-layout" value={a.layout} onChange={(e) => set("layout", e.target.value as Appearance["layout"], false)}>
              <option value="one_per_screen">Uma pergunta por tela</option>
              <option value="by_section">Agrupadas por etapa</option>
            </Select>
          </Field>
          <Field label="Tela final" htmlFor="ap-final">
            <Select id="ap-final" value={a.finalStyle} onChange={(e) => set("finalStyle", e.target.value as Appearance["finalStyle"], false)}>
              <option value="celebration">Com celebração</option>
              <option value="simple">Simples</option>
            </Select>
          </Field>
        </div>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
          <Switch label="Barra de progresso" checked={a.progressBar} onChange={(v) => set("progressBar", v, false)} />
          <Switch label="Animações suaves" checked={a.animations} onChange={(v) => set("animations", v, false)} />
          <Switch label="Revisar antes de enviar" description="Mostra um resumo das respostas antes do envio." checked={a.review} onChange={(v) => set("review", v, false)} />
        </div>
      </Panel>

      <Panel title="Mensagem final" description="Aparece depois do envio. O score nunca é mostrado para quem responde.">
        <Textarea aria-label="Mensagem final" value={draft.settings.completion} maxLength={1000} onChange={(e) => update((d) => void (d.settings.completion = e.target.value))} />
      </Panel>
    </div>
  );
}
