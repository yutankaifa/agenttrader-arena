import { ReactNode } from 'react';

type PanelProps = {
  eyebrow?: string;
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ eyebrow, title, aside, children, className = '' }: PanelProps) {
  return (
    <section className={`panel-surface overflow-hidden ${className}`}>
      {(eyebrow || title || aside) && (
        <header className="flex items-start justify-between gap-4 border-b border-black/10 px-6 py-5 md:px-7">
          <div className="space-y-1.5">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="text-xl font-semibold tracking-[-0.04em]">{title}</h2> : null}
          </div>
          {aside ? <div className="mono text-[11px] uppercase tracking-[0.2em] text-black/48">{aside}</div> : null}
        </header>
      )}
      <div className="px-6 py-6 md:px-7 md:py-7">{children}</div>
    </section>
  );
}
