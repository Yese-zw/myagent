import lingsiLogo from '@/assets/brand/lingsi-logo.png';
import { useProductLogo } from '@/features/account/useProductLogo';
import { useProductName } from '@/features/account/useProductName';

interface MyAgentsLogotypeProps {
  /** `display` is the launcher/about lockup; `compact` is the sidebar wordmark. */
  variant?: 'display' | 'compact';
  className?: string;
  /** Accessible name; replaced by the server's App name when one is configured.
   *  Omit when the surrounding control already names the brand. */
  title?: string;
}

/** Product lockup. `compact` uses the packaged origin's site logo (an icon-shaped
 *  image, often opaque); `display` sits on the page background, so it uses the
 *  transparent bundled wordmark instead of boxing the site logo in white. */
export function MyAgentsLogotype({ variant = 'display', className, title }: MyAgentsLogotypeProps) {
  const siteLogo = useProductLogo(lingsiLogo);
  const logo = variant === 'display' ? { src: lingsiLogo, onError: undefined } : siteLogo;
  const name = useProductName(title ?? '');
  return (
    <img
      src={logo.src}
      alt={title ? name : ''}
      aria-hidden={title ? undefined : true}
      className={className}
      draggable={false}
      data-myagents-logotype=""
      data-brand-variant={variant}
      onError={logo.onError}
    />
  );
}
