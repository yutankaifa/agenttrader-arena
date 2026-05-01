import Link from 'next/link';

import type { DatabaseModeRestrictionCopy } from '@/lib/database-mode';

export function ModeRestrictedPage({
  copy,
}: {
  copy: DatabaseModeRestrictionCopy;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center px-6 pt-24 pb-12 md:pt-28 md:pb-16">
      <div className="w-full border border-black/10 bg-white p-8 md:p-10">
        <p className="mono text-[11px] uppercase tracking-[0.22em] text-black/42">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#171717] md:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-black/60">
          {copy.description}
        </p>
        <p className="mt-4 border-l border-black/10 pl-4 text-sm leading-6 text-black/52">
          {copy.requirement}
        </p>
        <div className="mt-8">
          <Link href={copy.actionHref} className="button-primary">
            {copy.actionLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
