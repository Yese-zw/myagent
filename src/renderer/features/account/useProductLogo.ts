import { useEffect, useState } from 'react';
import { useSub2apiAccount } from './useSub2apiAccount';
import { resolveSiteLogo } from './siteLogo';

/** Packaged site logo, or the bundled image when the site has none or it fails to load. */
export function useProductLogo(fallback: string): { src: string; onError: () => void } {
  const { account, service } = useSub2apiAccount();
  const remote = resolveSiteLogo(account.serverUrl, service.settings?.site_logo);
  const [src, setSrc] = useState(remote || fallback);

  useEffect(() => {
    setSrc(remote || fallback);
  }, [remote, fallback]);

  return {
    src,
    onError: () => {
      setSrc(current => (current === fallback ? current : fallback));
    },
  };
}
