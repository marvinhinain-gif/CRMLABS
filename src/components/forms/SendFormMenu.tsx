"use client";

/**
 * Botão “Enviar formulário” do Direct: coloca na mensagem o link do formulário com o @ da pessoa (?ig=),
 * para a resposta chegar ligada ao Instagram dela sem precisar perguntar.
 */
import { useState } from "react";
import useSWR from "swr";
import { ClipboardList } from "lucide-react";
import { fetcher } from "@/lib/api";
import { personalLink } from "@/lib/quiz/instagramLink";
import { IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui";

type ShareForm = { id: string; name: string; url: string; origem: string | null };

export function SendFormMenu({ handle, onPick }: { handle: string | null; onPick: (link: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<ShareForm[]>(open ? "/api/forms/share" : null, fetcher);
  if (!handle) return null;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <IconButton label="Enviar formulário com o @ da pessoa" size="sm">
          <ClipboardList className="size-[18px]" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Formulário para @{handle}</MenuLabel>
        {!data && <p className="px-3 py-2 text-[13px] text-muted">Carregando…</p>}
        {data?.length === 0 && <p className="max-w-[240px] px-3 py-2 text-[13px] text-muted">Nenhum formulário publicado.</p>}
        {data?.map((f) => (
          <MenuItem key={f.id} onSelect={() => onPick(personalLink(f.url, handle, f.origem))}>
            {f.name}
          </MenuItem>
        ))}
        {!!data?.length && <p className="max-w-[260px] px-3 pb-2 pt-1 text-[11.5px] text-muted">A resposta chega com o Instagram @{handle}, mesmo sem a pergunta de Instagram.</p>}
      </MenuContent>
    </Menu>
  );
}
