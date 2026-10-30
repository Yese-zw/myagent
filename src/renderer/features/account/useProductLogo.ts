import { useState } from 'react';
import { useSub2apiAccount } from './useSub2apiAccount';
import { resolveSiteLogo } from './siteLogo';

/** Packaged site logo, or the bundled image when the site has none or it fails to load. */
export function useProductLogo(fallback: string): { src: string; onError: () => void } {
  const { account, service } = useSub2apiAccount();
  const remote = resolveSiteLogo(account.serverUrl, service.settings?.site_logo);
  const wanted = remote || fallback;
  const [failed, setFailed] = useState<string | null>(null);

  return {
    src: failed === wanted ? fallback : wanted,
    onError: () => setFailed(wanted),
  };
}
