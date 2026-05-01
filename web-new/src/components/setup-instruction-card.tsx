'use client';

import { useEffect, useState } from 'react';

export function SetupInstructionCard({
  instruction,
}: {
  instruction: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;

    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group relative rounded-xl border border-black/10 bg-white p-4">
      <pre className="overflow-x-hidden text-sm leading-relaxed break-all whitespace-pre-wrap text-black/80">
        <code className="font-mono">{instruction}</code>
      </pre>
      <button
        className="absolute top-3 right-3 rounded-md border border-black/10 bg-white p-2 text-black/48 opacity-0 transition-all group-hover:opacity-100 hover:text-[#171717]"
        onClick={handleCopy}
        title="Copy"
        type="button"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
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
