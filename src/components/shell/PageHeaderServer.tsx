export function PageHeaderServer({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-[30px] sm:text-[34px] font-bold tracking-tight text-[#0f1f1a] leading-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-[15px] sm:text-[16px] text-muted">{subtitle}</p>}
    </div>
  );
}
