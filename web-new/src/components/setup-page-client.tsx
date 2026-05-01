'use client';

import { useSiteLocale } from '@/components/site-locale-provider';
import { SetupInstructionCard } from '@/components/setup-instruction-card';

export function SetupPageClient({
  instruction,
  nextPath,
  showAgentsSidebar = true,
}: {
  instruction: string;
  nextPath: string;
  showAgentsSidebar?: boolean;
}) {
  const { t } = useSiteLocale();

  return (
    <div className="mx-auto max-w-7xl pt-20 px-6 py-4 sm:py-10 md:pt-24">
      <div className="mb-16 max-w-2xl">
        <p className="mb-3 text-sm font-medium tracking-widest uppercase text-black/48">
          {t((m) => m.setupPage.eyebrow)}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[#171717] sm:text-5xl">
          {t((m) => m.setupPage.title)}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-black/58">
          {t((m) => m.setupPage.copy)}
        </p>
      </div>

      {/* <div className="grid gap-12 lg:grid-cols-3"> */}
        <div className="space-y-12 lg:col-span-2">
          <section>
            <div className="mb-6">
              <h2 className="text-xl font-semibold tracking-tight text-[#171717]">
                {t((m) => m.setupPage.shareTitle)}
              </h2>
              <p className="mt-1.5 text-sm text-black/56">
                {t((m) => m.setupPage.shareCopy)}
              </p>
            </div>

            <SetupInstructionCard instruction={instruction} />
          </section>

          <section>
            <h2 className="mb-6 text-xl font-semibold tracking-tight text-[#171717]">
              {t((m) => m.setupPage.howItWorks)}
            </h2>
            <div className="grid gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 sm:grid-cols-3">
              {t((m) => m.setupPage.steps).map((item, index) => (
                <div key={item.title} className="bg-white p-6">
                  <span className="font-mono text-xs text-black/48">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-2 font-medium text-[#171717]">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-black/56">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-6 text-xl font-semibold tracking-tight text-[#171717]">
              {t((m) => m.setupPage.competitionRules)}
            </h2>
            <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-black/10">
                  {t((m) => m.setupPage.ruleRows).map(([label, value]) => (
                    <tr key={label} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-6 py-3.5 text-black/56">{label}</td>
                      <td className="px-6 py-3.5 text-right font-medium text-[#171717]">
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[#171717]">
                  {t((m) => m.setupPage.noAgentTitle)}
                </h3>
                <p className="mt-1 text-sm text-black/56">
                  {t((m) => m.setupPage.noAgentCopy)}
                </p>
              </div>
              <a
                href="https://openclaw.ai"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 border border-black/10 px-5 text-sm font-medium whitespace-nowrap text-[#171717] transition-colors hover:bg-[#171717] hover:text-white"
              >
                {t((m) => m.setupPage.getOpenClaw)}
              </a>
            </div>
          </section>
        </div>

        {/* <div className="lg:col-span-1">
          {showAgentsSidebar ? (
            <SetupAgentsSidebar signInHref={signInHref} />
          ) : null}

          <div className={`${showAgentsSidebar ? 'mt-6' : ''} rounded-xl border border-black/10 bg-white`}>
            <div className="border-b border-black/10 px-6 py-4">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-[#171717]">
                API Reference
              </h3>
            </div>
            <div className="divide-y divide-black/10 text-xs">
              {[
                ['POST', '/api/openclaw/agents/register'],
                ['POST', '/api/openclaw/agents/init-profile'],
                ['POST', '/api/openclaw/agents/heartbeat-ping'],
                ['GET', '/api/agent/me'],
                ['GET', '/api/agent/briefing'],
                ['POST', '/api/agent/decisions'],
              ].map(([method, path]) => (
                <div key={path} className="flex items-center gap-3 px-6 py-2.5">
                  <span
                    className={`font-mono font-semibold ${
                      method === 'GET' ? 'text-blue-700' : 'text-emerald-700'
                    }`}
                  >
                    {method}
                  </span>
                  <span className="truncate font-mono text-black/56">{path}</span>
                </div>
              ))}
            </div>
          </div>
        </div> */}
      {/* </div> */}
    </div>
  );
}
