import { getSiteMessages } from '@/messages';
import { getRequestSiteLocale } from '@/lib/site-locale-server';
import { getBriefingWindowMinutes } from '@/lib/trading-rules';

type MethodDiagramNode = {
  label: string;
  value: string;
  detail: string;
};

type MethodDiagramBar = {
  label: string;
  value: number;
};

type MethodDiagramData = {
  metric: string;
  metricLabel: string;
  caption: string;
  nodes: readonly MethodDiagramNode[];
  bars?: readonly MethodDiagramBar[];
};

const briefingWindowMinutes = getBriefingWindowMinutes();

function interpolate(value: string) {
  return value.replace('{briefingWindowMinutes}', String(briefingWindowMinutes));
}

function MethodDiagram({
  diagram,
  mechanismLabel,
}: {
  diagram: MethodDiagramData;
  mechanismLabel: string;
}) {
  return (
    <div className="mt-7 border border-black/10 bg-[#fafaf8]">
      <div className="grid gap-0 border-b border-black/10 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="border-b border-black/10 bg-white px-5 py-5 md:border-r md:border-b-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-black/38">
            {mechanismLabel}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-[#171717]">
            {interpolate(diagram.metric)}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">
            {interpolate(diagram.metricLabel)}
          </p>
        </div>

        <div className="px-5 py-5">
          <div className="grid gap-3 lg:grid-cols-4">
            {diagram.nodes.map((node, index) => (
              <div key={node.label} className="relative">
                <div className="h-full border border-black/10 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/38">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">
                      {interpolate(node.value)}
                    </p>
                  </div>
                  <p className="mt-5 text-base font-semibold tracking-[-0.04em] text-[#171717]">
                    {node.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-black/52">{interpolate(node.detail)}</p>
                </div>
                {index < diagram.nodes.length - 1 ? (
                  <div className="absolute top-1/2 left-full z-10 hidden h-px w-3 bg-black/22 lg:block" />
                ) : null}
              </div>
            ))}
          </div>

          {diagram.bars ? (
            <div className="mt-5 space-y-3 border-t border-black/10 pt-5">
              {diagram.bars.map((bar) => (
                <div key={bar.label}>
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">
                      {bar.label}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">
                      {bar.value}%
                    </p>
                  </div>
                  <div className="h-2 bg-black/8">
                    <div className="h-full bg-[#171717]" style={{ width: `${bar.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className="mt-5 border-t border-black/10 pt-4 text-sm leading-7 text-black/56">
            {interpolate(diagram.caption)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function MethodologyPage() {
  const locale = await getRequestSiteLocale();
  const text = getSiteMessages(locale).methodologyPage;

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
        <section id="methodology" className="border-x border-b border-black/10 bg-white">
          <div className="overflow-hidden border-0">
            <div className="grid gap-6 border-b border-black/10 px-6 py-7 md:px-8 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end">
              <div>
                <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-black/42">
                  {text.eyebrow}
                </p>
                <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-[#171717] md:text-5xl">
                  {text.title}
                </h1>
                <p className="mt-5 max-w-5xl text-2xl font-semibold leading-9 tracking-[-0.045em] text-[#171717] md:text-3xl md:leading-10 xl:whitespace-nowrap">
                  {text.subtitle}
                </p>
                <p className="mt-4 max-w-6xl text-base leading-8 text-black/60 xl:whitespace-nowrap">
                  {text.description}
                </p>
              </div>

              <div className="border border-black/12 bg-[#fafaf8] px-4 py-4">
                <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/42">
                  {text.coreStandard}
                </p>
                <div className="mt-4 space-y-2">
                  {text.principles.map((principle) => (
                    <div
                      key={principle}
                      className="border border-[#171717] bg-[#171717] px-4 py-3 text-white"
                    >
                      <p className="text-lg font-semibold tracking-[-0.04em]">{principle}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-0 border-b border-black/10 md:grid-cols-4">
              {text.metrics.map((metric, index) => (
                <div
                  key={metric.label}
                  className={`px-6 py-5 md:px-8 ${
                    index < text.metrics.length - 1
                      ? 'border-b border-black/10 md:border-r md:border-b-0'
                      : ''
                  }`}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/38">
                    {metric.label}
                  </p>
                  <p className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-[#171717]">
                    {interpolate(metric.value)}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-black/54">{interpolate(metric.detail)}</p>
                </div>
              ))}
            </div>

            <div className="px-6 py-2 md:px-10">
              {text.sections.map((section, index) => (
                <section
                  key={section.title}
                  className="grid gap-5 border-b border-black/10 py-8 md:grid-cols-[140px_minmax(0,1fr)]"
                >
                  <div>
                    <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/38">
                      {text.methodLabel.replace('{value}', String(index + 1).padStart(2, '0'))}
                    </p>
                  </div>
                  <div className="max-w-4xl">
                    <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
                      {section.title}
                    </h2>
                    <div className="mt-5 space-y-3">
                      {section.body.map((paragraph) => (
                        <p
                          key={`${section.title}-${paragraph}`}
                          className="text-base leading-8 text-black/64 md:text-lg md:leading-9"
                        >
                          {interpolate(paragraph)}
                        </p>
                      ))}
                    </div>
                    {'diagram' in section && section.diagram ? (
                      <MethodDiagram diagram={section.diagram} mechanismLabel={text.mechanism} />
                    ) : null}
                  </div>
                </section>
              ))}
            </div>

            <div className="border-t border-black/10 bg-[#fafaf8] px-6 py-8 md:px-10">
              <div className="grid gap-5 md:grid-cols-[140px_minmax(0,1fr)]">
                <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-black/38">
                  {text.principleLabel}
                </p>
                <div className="max-w-4xl">
                  <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
                    {text.sharedInfrastructure}
                  </h2>
                  <p className="mt-5 text-base leading-8 text-black/64 md:text-lg md:leading-9">
                    {text.sharedDescription}
                  </p>
                  <p className="mt-5 text-2xl font-semibold tracking-[-0.05em] text-[#171717]">
                    {text.sharedVision}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
