"use client";

import { clsx } from "clsx";
import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CircleAlert, LoaderCircle, Lock, RefreshCw, X } from "lucide-react";
import { initials } from "@/lib/format";

export const cx = clsx;

// ---------- Botões ----------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-[0_1px_0_rgb(0_0_0/0.04)]",
  secondary: "bg-white text-ink border border-line hover:bg-page",
  ghost: "text-ink hover:bg-page",
  danger: "bg-danger text-white hover:brightness-95",
  soft: "bg-selected text-brand hover:brightness-[0.97] border border-[#c9ebdc]",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" | "lg"; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-medium rounded-[14px] transition-colors whitespace-nowrap disabled:opacity-55 disabled:cursor-not-allowed",
        size === "md" && "h-11 px-4 text-[14px]",
        size === "lg" && "h-[52px] px-6 text-[16px] font-semibold",
        size === "sm" && "h-9 px-3 text-[13px] rounded-[12px]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "md" | "sm" }>(function IconButton(
  { label, className, children, size = "md", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-[12px] text-muted hover:text-ink hover:bg-page transition-colors disabled:opacity-50",
        size === "md" ? "size-11" : "size-8",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---------- Campos ----------
export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[14px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-danger flex items-center gap-1" role="alert">
          <CircleAlert className="size-3.5" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Remove "w-full" quando o chamador define uma largura própria (evita conflito de utilitários). */
const withWidth = (base: string, extra?: string) => (extra && /(^|\s)w-/.test(extra) ? base.replace("w-full ", "") : base);

const fieldBase =
  "w-full rounded-[14px] border border-line bg-white px-3.5 text-[14.5px] text-ink placeholder:text-[#94a3ad] transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10 disabled:bg-page disabled:text-muted aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode; invalid?: boolean }>(function Input(
  { icon, trailing, className, invalid, ...rest },
  ref,
) {
  return (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted [&>svg]:size-[18px]">{icon}</span>}
      <input ref={ref} aria-invalid={invalid || undefined} className={cx(fieldBase, "h-11", icon && "pl-11", trailing && "pr-12", className)} {...rest} />
      {trailing && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, "py-2.5 min-h-[88px] resize-y", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(
        withWidth(fieldBase, className),
        "h-11 appearance-none pr-9 truncate bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23607080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")] bg-no-repeat bg-[right_10px_center]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, checked, onChange, id }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className="inline-flex items-center gap-2.5 cursor-pointer text-[14px] text-muted select-none">
      <input id={cid} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 rounded-[6px] border-line accent-[#008a65] cursor-pointer" />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-[14px] font-medium text-ink cursor-pointer">
          {label}
        </label>
        {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
      </div>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand" : "bg-[#cfdad6]")}
      >
        <span className={cx("absolute left-0 top-1 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </div>
  );
}

// ---------- Visual ----------
export function Card({ className, children, as: As = "section", style }: { className?: string; children: ReactNode; as?: "section" | "div" | "article"; style?: React.CSSProperties }) {
  return (
    <As className={cx("bg-card rounded-[var(--radius-card)] border border-line/70 shadow-[var(--shadow-soft)]", className)} style={style}>
      {children}
    </As>
  );
}

const AVATAR_TONES = [
  ["#e3f4ec", "#147d55"],
  ["#e7effb", "#2463b5"],
  ["#fdf3dc", "#9a6700"],
  ["#f0eafc", "#7048c8"],
  ["#fbe9ee", "#bf3a5b"],
  ["#e6f6f5", "#0e7f76"],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, src, size = 44, tone, className }: { name?: string | null; src?: string | null; size?: number; tone?: "neutral"; className?: string }) {
  const [bg, fg] = tone === "neutral" ? ["#eef2f1", "#46565f"] : AVATAR_TONES[hash(name ?? "?") % AVATAR_TONES.length];
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(src)}
        className={cx("rounded-full object-cover shrink-0 bg-[#eef2f1]", className)}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx("inline-flex items-center justify-center rounded-full font-semibold shrink-0", className)}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand"; className?: string }) {
  const tones = {
    neutral: "bg-[#eef2f1] text-[#46565f]",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
    brand: "bg-selected text-brand",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function StageChip({ name, color }: { name: string; color?: string | null }) {
  const c = color ?? "gray";
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium whitespace-nowrap" style={{ background: `var(--stage-${c}-bg)`, color: "#24343d" }}>
      <span className="size-2 rounded-full" style={{ background: `var(--stage-${c}-dot)` }} aria-hidden />
      {name}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx("size-5 animate-spin text-brand", className)} aria-label="Carregando" />;
}

// ---------- Estados ----------
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3", className)} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center py-10 px-6", className)}>
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-selected text-brand [&>svg]:size-6">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const status = (error as { status?: number })?.status;
  if (status === 403) return <NoPermission className={className} />;
  return (
    <div role="alert" className={cx("flex flex-col items-center text-center py-10 px-6", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <CircleAlert className="size-6" aria-hidden />
      </div>
      <p className="text-[15px] font-semibold">Não foi possível carregar</p>
      <p className="mt-1 max-w-sm text-[13.5px] text-muted">{(error as Error)?.message ?? "Tente novamente em instantes."}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function NoPermission({ className, message }: { className?: string; message?: string }) {
  return (
    <div className={cx("flex flex-col items-center text-center py-12 px-6", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#eef2f1] text-muted">
        <Lock className="size-6" aria-hidden />
      </div>
      <p className="text-[15px] font-semibold">Sem permissão</p>
      <p className="mt-1 max-w-sm text-[13.5px] text-muted">{message ?? "Seu papel não tem acesso a esta área. Fale com o administrador se precisar."}</p>
    </div>
  );
}

// ---------- Diálogo e painel lateral ----------
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[#0d2a22]/30 backdrop-blur-[2px]" />
        <RDialog.Content
          className={cx(
            "fixed z-50 bg-white shadow-[var(--shadow-pop)] flex flex-col max-h-[100dvh]",
            "inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:max-h-[88vh] w-full",
            size === "sm" && "sm:max-w-[420px]",
            size === "md" && "sm:max-w-[560px]",
            size === "lg" && "sm:max-w-[820px]",
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-3">
            <div>
              <RDialog.Title className="text-[19px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-[13.5px] text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Fechar" size="sm">
                <X className="size-5" />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="px-6 pb-4 overflow-y-auto scroll-thin flex-1">{children}</div>
          {footer && <div className="px-6 py-4 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Painel lateral no desktop; tela inteira em telas pequenas. */
export function Sheet({ open, onOpenChange, title, children, width = 520 }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: ReactNode; width?: number }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[#0d2a22]/25" />
        <RDialog.Content className="fixed z-50 inset-0 md:inset-y-3 md:right-3 md:left-auto bg-white md:rounded-[24px] shadow-[var(--shadow-pop)] flex flex-col w-full" style={{ maxWidth: `min(100vw, ${width}px)` }}>
          <RDialog.Title className="sr-only">{title}</RDialog.Title>
          <RDialog.Description className="sr-only">{title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
export const SheetClose = RDialog.Close;

// ---------- Menu ----------
export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;
export function MenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} sideOffset={6} className="z-50 min-w-[220px] rounded-[var(--radius-menu)] border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, disabled, icon }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[14px] outline-none cursor-pointer data-[highlighted]:bg-page data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed [&>svg]:size-4",
        danger ? "text-danger" : "text-ink",
      )}
    >
      {icon}
      {children}
    </RMenu.Item>
  );
}
export const MenuSub = RMenu.Sub;
export function MenuSubTrigger({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <RMenu.SubTrigger className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[14px] outline-none cursor-pointer data-[highlighted]:bg-page data-[state=open]:bg-page [&>svg]:size-4">
      {icon}
      {children}
    </RMenu.SubTrigger>
  );
}
export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <RMenu.Portal>
      <RMenu.SubContent sideOffset={6} className="z-50 min-w-[220px] rounded-[var(--radius-menu)] border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
        {children}
      </RMenu.SubContent>
    </RMenu.Portal>
  );
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-3 pt-2 pb-1 text-[12px] font-medium text-muted">{children}</RMenu.Label>;
}
export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-line" />;

// ---------- Abas ----------
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex items-center gap-1 rounded-[18px] border border-line bg-white p-1 max-w-full overflow-x-auto scroll-thin", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={(e) => {
              onChange(it.value);
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
            }}
            className={cx(
              "inline-flex items-center gap-1.5 sm:gap-2 rounded-[14px] px-3 sm:px-4 h-10 text-[14px] sm:text-[14.5px] font-medium transition-colors whitespace-nowrap shrink-0 [&>svg]:size-[18px]",
              active ? "bg-selected text-brand border border-[#c9ebdc]" : "text-ink hover:bg-page border border-transparent",
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined && <span className={cx("rounded-full px-2 text-[12px]", active ? "bg-white" : "bg-page")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, subtitle, badge, actions }: { title: string; subtitle?: string; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="anim-fade text-[28px] sm:text-[34px] font-bold tracking-tight text-[#0f1f1a] leading-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-[15px] sm:text-[16px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 max-sm:[&>*]:grow">{actions}</div>}
    </div>
  );
}

export function DemoBadge() {
  return <span className="rounded-full bg-[#eef2f1] px-3.5 py-1.5 text-[13px] font-medium text-[#3d4d56]">Dados demonstrativos</span>;
}
