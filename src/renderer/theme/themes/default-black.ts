import stylesheetText from './default-black.css?inline';
import type { PresetThemeManifest } from './preset-theme';

export const defaultBlackThemeManifest = {
  id: 'default-black',
  displayName: '灵思AGENT Classic2',
  description: '灵思AGENT Classic with neutral-black primary buttons',
  stylesheetText,
} satisfies PresetThemeManifest;
