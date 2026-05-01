import { getSiteMessages } from '@/messages';
import { getRequestSiteLocale } from '@/lib/site-locale-server';
import { COMPETITION_PHASE, getBriefingWindowMinutes } from '@/lib/trading-rules';

const briefingWindowMinutes = getBriefingWindowMinutes();

function interpolate(value: string, briefingPhaseLabel: string) {
  return value
    .replace('{briefingWindowMinutes}', String(briefingWindowMinutes))
    .replace('{briefingPhaseLabel}', briefingPhaseLabel);
}

export default async function RulesPage() {
  const locale = await getRequestSiteLocale();
  const text = getSiteMessages(locale).rulesPage;
  const briefingPhaseLabel =
    COMPETITION_PHASE === 'official'
      ? text.briefingPhaseOfficial
      : text.briefingPhaseTesting;

  return (
    <main
      className="min-h-screen pt-20 text-[#171717] md:pt-24"
      style={{
        backgroundColor: '#f3f3ef',
        backgroundImage:
          'radial-gradient(circle at top, rgba(0, 0, 0, 0.05), transparent 24%), linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px)',
        backgroundPosition: 'center top, center top, center top',
        backgroundSize: 'auto, 88px 88px, 88px 88px',
      }}
    >
      <div className="mx-auto max-w-[1480px] px-4 pb-10 md:px-6">
        <section id="rules" className="border-x border-b border-black/10 bg-white">
          <div className="overflow-hidden border-0">
            <div className="grid gap-6 border-b border-black/10 px-6 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
              <div>
                <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-black/42">
                  {text.eyebrow}
                </p>
                <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-[#171717] md:text-5xl">
                  {text.title}
                </h1>
                <p className="mt-4 max-w-5xl text-base leading-8 text-black/60 lg:whitespace-nowrap">
                  {text.description}
                </p>
              </div>

              <div className="border border-black/12 bg-white px-4 py-4">
                <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/42">
                  {text.trustStandard}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {text.trustSignals.map((signal) => (
                    <div
                      key={signal}
                      className="border border-[#171717] bg-[#171717] px-3 py-3 text-white"
                    >
                      <p className="text-lg font-semibold tracking-[-0.04em]">{signal}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-2 md:px-10">
              {text.sections.map((rule, index) => (
                <section
                  key={rule.title}
                  className="grid gap-5 border-b border-black/10 py-8 md:grid-cols-[140px_minmax(0,1fr)]"
                >
                  <div>
                    <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/38">
                      {text.articleLabel.replace('{value}', String(index + 1).padStart(2, '0'))}
                    </p>
                  </div>
                  <div className="max-w-4xl">
                    <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
                      {rule.title}
                    </h2>
                    <div className="mt-5 space-y-3">
                      {rule.items.map((item) => (
                        <p
                          key={`${rule.title}-${item}`}
                          className="text-base leading-8 text-black/64 md:text-lg md:leading-9"
                        >
                          {interpolate(item, briefingPhaseLabel)}
                        </p>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <div className="border-t border-black/10 bg-[#fafaf8] px-6 py-8 md:px-10">
              <div className="grid gap-5 md:grid-cols-[140px_minmax(0,1fr)]">
                <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/38">
                  {text.versionLabel}
                </p>
                <div className="max-w-4xl">
                  <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
                    {text.versionTitle}
                  </h2>
                  <p className="mt-3 text-lg leading-9 text-black/60">{text.versionDescription}</p>
                  <div className="mt-6 space-y-3 border-t border-black/10 pt-5">
                    {text.versionChanges.map((change) => (
                      <p
                        key={change}
                        className="text-base leading-8 text-black/64 md:text-lg md:leading-9"
                      >
                        {interpolate(change, briefingPhaseLabel)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
