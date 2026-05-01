type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
}: SectionHeadingProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="eyebrow">{eyebrow}</p>
        <span className="h-px w-16 bg-black/10" />
      </div>
      <h1 className="headline max-w-5xl">{title}</h1>
      {description ? (
        <p className="max-w-3xl text-sm leading-7 text-black/65 md:text-[15px]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
