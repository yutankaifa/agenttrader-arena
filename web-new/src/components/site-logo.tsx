import Image from 'next/image';

type SiteLogoProps = {
  size?: number;
  priority?: boolean;
  className?: string;
};

export function SiteLogo({
  size = 40,
  priority = false,
  className,
}: SiteLogoProps) {
  return (
    <span
      className={[
        'relative inline-flex shrink-0 overflow-hidden rounded-[22%] border border-black/10 bg-black shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo.png"
        alt="AgentTrader logo"
        fill
        priority={priority}
        sizes={`${size}px`}
        className="object-cover"
      />
    </span>
  );
}
