/**
 * @project DomusApp - Admin
 * @file src/global/atoms/brand/Logo.tsx
 * @description Marca de DomusApp: isotipo (casa) y logotipo
 */

interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 40, className }: Readonly<LogoMarkProps>) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--color-brand-700)" />
      <path d="M14 31 32 16l18 15" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 28v19h26V28" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M28 47V36h8v11" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 36, className = "" }: Readonly<LogoMarkProps>) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="DomusApp">
      <LogoMark size={size} />
      <span className="font-extrabold tracking-tight text-gray-900" style={{ fontSize: size * 0.62 }}>
        Domus<span className="text-brand-700">App</span>
      </span>
    </span>
  );
}
