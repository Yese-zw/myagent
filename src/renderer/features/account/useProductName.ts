import { useSub2apiAccount } from './useSub2apiAccount';

/** App name from the packaged origin's "App" settings, or the built-in name. */
export function useProductName(fallback: string): string {
  const { service } = useSub2apiAccount();
  return service.settings?.app_name?.trim() || fallback;
}
