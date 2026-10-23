const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;charset=[^;,]+)?(?:;base64)?,/i;
const MAX_DATA_URL_LENGTH = 4 * 1024 * 1024;

/** Image address for the packaged site's logo. Empty when the value cannot be shown. */
export function resolveSiteLogo(serverUrl: string, siteLogo: string | null | undefined): string {
  const value = siteLogo?.trim() ?? '';
  if (!value) return '';
  if (value.startsWith('data:')) {
    return IMAGE_DATA_URL.test(value) && value.length <= MAX_DATA_URL_LENGTH ? value : '';
  }

  let origin: URL;
  try {
    origin = new URL(serverUrl);
  } catch {
    return '';
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return '';

  let resolved: URL;
  try {
    if (value.startsWith('/') && !value.startsWith('//')) {
      resolved = new URL(value, origin.origin);
    } else if (/^https?:\/\//i.test(value)) {
      resolved = new URL(value);
    } else {
      return '';
    }
  } catch {
    return '';
  }
  if (resolved.username || resolved.password) return '';
  if (resolved.protocol === 'https:') return resolved.toString();
  if (resolved.protocol === 'http:' && resolved.origin === origin.origin && origin.protocol === 'http:') {
    return resolved.toString();
  }
  return '';
}
