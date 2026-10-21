import type { TabBase } from '@/tab-workspace/contracts';

export type AccountSection = 'dashboard' | 'profile' | 'models' | 'keys' | 'usage' | 'orders' | 'redeem';

export type AccountTab = TabBase<'account'>;
