"use client";

import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { toast } from "sonner";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Avatar, Button, Dialog } from "@/components/ui";

const SIDE = 512;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/** Recorta no centro em quadrado e reduz para 512×512 no próprio aparelho (envio rápido mesmo no 4G). */
async function prepare(file: File): Promise<Blob> {
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // o servidor valida e converte
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(SIDE, side);
  const g = canvas.getContext("2d");
  if (!g) return file;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  return blob ?? file;
}

async function send(method: "POST" | "DELETE", body?: FormData) {
  let res: Response;
  try {
    res = await fetch("/api/me/avatar", { method, body, credentials: "same-origin" });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique sua internet e tente novamente.", 0, "network");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.message ?? "Não foi possível salvar a foto.", res.status);
}

export function ProfilePhoto({ name, src }: { name: string; src: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const refresh = () => Promise.all([mutate("/api/me"), mutate("/api/team")]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) return toast.error("Imagem grande demais. Escolha uma foto menor.");
    setBusy(true);
    try {
      const blob = await prepare(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", preview.blob, "foto.jpg");
      await send("POST", fd);
      await refresh();
      setPreview(null);
      toast.success("Foto de perfil atualizada.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await send("DELETE");
      await refresh();
      toast.success("Foto removida.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:items-start">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        aria-label={src ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
        disabled={busy}
      >
        <Avatar name={name} src={src} size={96} tone="neutral" className="ring-4 ring-selected transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute -bottom-0.5 -right-0.5 flex size-9 items-center justify-center rounded-full border-[3px] border-card bg-brand text-white shadow-md transition-transform group-hover:scale-110">
          <Camera className="size-4" aria-hidden />
        </span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          <ImageUp className="size-4" aria-hidden /> {src ? "Trocar foto" : "Adicionar foto"}
        </Button>
        {src && (
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
            <Trash2 className="size-4" aria-hidden /> Remover
          </Button>
        )}
      </div>

      <Dialog
        open={!!preview}
        onOpenChange={(o) => !o && !busy && setPreview(null)}
        title="Nova foto de perfil"
        description="É assim que a equipe vai ver você no CRMLABS."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={save} loading={busy}>
              Salvar foto
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex items-center justify-center gap-6 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt="Prévia da nova foto" className="size-40 rounded-full object-cover ring-4 ring-selected animate-[pop-in_.35s_ease-out]" />
            <div className="hidden flex-col items-center gap-3 sm:flex" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="" className="size-12 rounded-full object-cover" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="" className="size-8 rounded-full object-cover" />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
