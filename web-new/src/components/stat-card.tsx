type StatCardProps = {
  label: string;
  value: string;
  note?: string;
};

export function StatCard({ label, value, note }: StatCardProps) {
  return (
    <div className="flex min-h-[148px] flex-col justify-between rounded-[24px] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,242,233,0.95))] px-5 py-5 shadow-[0_18px_36px_rgba(33,22,13,0.06)]">
      <p className="mono text-[11px] uppercase tracking-[0.28em] text-black/45">
        {label}
      </p>
      <div className="space-y-2.5">
        <p className="text-[2rem] font-semibold tracking-[-0.06em] md:text-[2.35rem]">
          {value}
        </p>
        {note ? <p className="text-sm text-black/55">{note}</p> : null}
      </div>
    </div>
  );
}
