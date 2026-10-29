import { resolveSiteLogo } from './siteLogo';
import { useSub2apiAccount } from './useSub2apiAccount';

/** Gateway community-group image, or empty when the site has not uploaded one. */
export function useCommunityGroupImage(): string {
  const { account, service } = useSub2apiAccount();
  return resolveSiteLogo(account.serverUrl, service.settings?.community_group_image);
}
