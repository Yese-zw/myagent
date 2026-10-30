export type SettingsSection =
  | 'general'
  | 'proxy'
  | 'external-cli'
  | 'shortcuts'
  | 'providers'
  | 'mcp'
  | 'skills'
  | 'sub-agents'
  | 'plugins'
  | 'agent'
  | 'desktop-pet'
  | 'about'
  | 'developer';

export const VALID_SECTIONS: SettingsSection[] = [
  'general',
  'proxy',
  'external-cli',
  'shortcuts',
  'providers',
  'mcp',
  'skills',
  'sub-agents',
  'plugins',
  'agent',
  'desktop-pet',
  'about',
  'developer',
];


export const PLAYWRIGHT_DEVICE_PRESETS = [
  'iPhone 15 Pro',
  'iPhone 15',
  'iPhone SE',
  'iPad Pro 11',
  'Pixel 7',
  'Galaxy S23',
];
