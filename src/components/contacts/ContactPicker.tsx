"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, qs } from "@/lib/api";
import { Avatar, Button, Input } from "@/components/ui";

export type PickedContact = { id: string; name: string };

/** Busca e escolhe um contato (nome ou @). */
export function ContactPicker({ value, onChange, placeholder = "Buscar contato por nome ou @" }: { value: PickedContact | null; onChange: (v: PickedContact | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const { data } = useSWR<{ rows: { id: string; name: string; username: string | null }[] }>(q.length >= 2 && !value ? `/api/contacts${qs({ q, pageSize: 6 })}` : null, fetcher);
  if (value)
    return (
      <div className="flex items-center gap-3 rounded-[14px] border border-brand bg-selected/50 px-3 py-2">
        <Avatar name={value.name} size={30} />
        <span className="flex-1 truncate text-[14px] font-medium">{value.name}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Buscar contato" />
      {data?.rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onChange({ id: r.id, name: r.name })} className="mt-1 flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[14px] hover:bg-page">
          <Avatar name={r.name} size={26} /> {r.name} <span className="text-[12.5px] text-muted">{r.username ? `@${r.username}` : ""}</span>
        </button>
      ))}
    </div>
  );
}
