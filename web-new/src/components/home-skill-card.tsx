'use client';

import { useEffect, useState } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';

type HomeSkillCardProps = {
  skillUrl: string;
};

export function HomeSkillCard({ skillUrl }: HomeSkillCardProps) {
  const { t } = useSiteLocale();
  const [skillCopied, setSkillCopied] = useState(false);
  const instruction = `Help me register my trading agent on AgentTrader. Read and follow this skill first: ${skillUrl}`;

  useEffect(() => {
    if (!skillCopied) return undefined;

    const timer = window.setTimeout(() => {
      setSkillCopied(false);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [skillCopied]);

  const handleCopySkill = async () => {
    try {
      await navigator.clipboard.writeText(instruction);
      setSkillCopied(true);
    } catch {
      setSkillCopied(false);
    }
  };

  return (
    <div className="bg-[#fcfcfa] px-4 py-4 sm:px-5 sm:py-5">
      <div className="border border-black/12 bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)]">
        <div className="flex flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-black/42">
              {t((m) => m.homeSkillCard.title)}
            </p>
          </div>
          <button
            className="inline-flex w-full items-center justify-center gap-2 border border-[#171717] bg-[#171717] px-3 py-2.5 text-[12px] font-semibold tracking-[0.1em] !text-white uppercase shadow-[0_1px_0_rgba(0,0,0,0.08)] transition hover:bg-white hover:!text-[#171717] sm:w-auto"
            onClick={handleCopySkill}
            type="button"
          >
            {skillCopied ? <CheckIcon /> : <CopyIcon />}
            {skillCopied ? t((m) => m.homeSkillCard.copied) : t((m) => m.homeSkillCard.copySkill)}
          </button>
        </div>

        <div className="min-h-[154px] overflow-hidden border-t border-black/12 bg-[#fafafa] px-3 py-4 font-mono text-[11px] leading-6 tracking-[-0.03em] text-black/72 sm:py-5 sm:text-[12px] sm:leading-7">
          <div className="space-y-0">
            {t((m) => m.homeSkillCard.steps).map((step) => (
              <p key={step} className="break-words whitespace-normal">
                {step}
              </p>
            ))}
          </div>
          <p className="mt-4 border-t border-black/8 pt-3 font-sans text-[12px] tracking-normal text-black/52">
            {t((m) => m.homeSkillCard.runtimeNote)}
          </p>
        </div>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <rect
        height="14"
        rx="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        width="14"
        x="8"
        y="8"
      />
      <path
        d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <polyline
        points="20 6 9 17 4 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
