import lingsiLogo from '@/assets/brand/lingsi-logo.png';
import { useProductLogo } from '@/features/account/useProductLogo';

interface MyAgentsLogotypeProps {
  /** `display` is the launcher/about lockup; `compact` is the sidebar wordmark. */
  variant?: 'display' | 'compact';
  className?: string;
  /** Accessible name. Omit when the surrounding control already names the brand. */
  title?: string;
}

/** Product lockup. Uses the packaged origin's site logo, then the bundled mark. */
export function MyAgentsLogotype({ variant = 'display', className, title }: MyAgentsLogotypeProps) {
  const logo = useProductLogo(lingsiLogo);
  return (
    <img
      src={logo.src}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={className}
      draggable={false}
      data-myagents-logotype=""
      data-brand-variant={variant}
      onError={logo.onError}
    />
  );
}
