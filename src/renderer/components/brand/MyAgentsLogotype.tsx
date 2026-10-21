import lingsiLogo from '@/assets/brand/lingsi-logo.png';

interface MyAgentsLogotypeProps {
  /** `display` is the launcher/about lockup; `compact` is the sidebar wordmark. */
  variant?: 'display' | 'compact';
  className?: string;
  /** Accessible name. Omit when the surrounding control already names the brand. */
  title?: string;
}

/** Website lockup from the configured product origin (lingsiai.vip). */
export function MyAgentsLogotype({ variant = 'display', className, title }: MyAgentsLogotypeProps) {
  return (
    <img
      src={lingsiLogo}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={className}
      draggable={false}
      data-myagents-logotype=""
      data-brand-variant={variant}
    />
  );
}
