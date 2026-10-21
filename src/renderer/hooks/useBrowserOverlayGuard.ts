/**
 * useBrowserOverlayGuard — Detects visible overlay backdrops that would
 * cover the native browser Webview.
 *
 * Returns `true` when a full-screen overlay backdrop is present, `false` otherwise.
 * The caller (BrowserPanel) uses this in a combined visibility effect to decide
 * whether to show/hide the native Webview.
 *
 * Modal backdrops are centrally owned per specs/DESIGN.md §5.5. Detection
 * uses `data-overlay-backdrop` / `data-suppress-browser`, then `backdrop-blur`
 * + `position: fixed` for older overlays. That distinguishes full-screen
 * overlays from small fixed elements (toasts, tooltips).
 *
 * Also checks `data-suppress-browser` attribute as a manual escape hatch.
 *
 * Scans only `document.body` direct children (overlays use `createPortal`
 * to body). MutationObserver on childList only + rAF debounce for minimal overhead.
 */

import { useEffect, useRef, useState } from 'react';

function checkOverlays(): boolean {
  // Manual escape hatch, including OverlayBackdrop (blur lives on a sibling
  // so WKWebView can type into the panel; the root still marks the overlay).
  if (document.querySelector('[data-suppress-browser], [data-overlay-backdrop]')) return true;

  // Scan body's direct children for overlay backdrops.
  // Design system convention: overlays use position:fixed + backdrop-blur.
  // This skips toasts, tooltips, and other small fixed elements.
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    const style = getComputedStyle(child);
    // Older WebKit only exposes the prefixed property. CSSOM returns an
    // empty string for unsupported properties; the JS accessor may be absent.
    if (
      style.position === 'fixed' &&
      (style.getPropertyValue('backdrop-filter').includes('blur') ||
        style.getPropertyValue('-webkit-backdrop-filter').includes('blur'))
    ) {
      return true;
    }
  }
  return false;
}

export function useBrowserOverlayGuard(active: boolean): boolean {
  const [overlayDetected, setOverlayDetected] = useState(false);
  const rafIdRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const sync = () => {
      setOverlayDetected(checkOverlays());
    };

    const debouncedSync = () => {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(sync);
    };

    // Only watch body's direct children (where createPortal mounts overlays)
    const observer = new MutationObserver(debouncedSync);
    observer.observe(document.body, { childList: true });

    // Initial check
    sync();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafIdRef.current);
      setOverlayDetected(false);
    };
  }, [active]);

  return overlayDetected;
}
