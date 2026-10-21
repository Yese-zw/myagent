import {
  forwardRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * OverlayBackdrop — Pit-of-success backdrop for all overlay/modal components.
 *
 * Encapsulates the correct dismissal behavior (onMouseDown on the dimmer only)
 * so individual overlay components cannot get it wrong. Using onClick on a backdrop is a
 * common bug: text selection that starts inside the panel and ends outside triggers a
 * click on the backdrop, closing the overlay unexpectedly.
 *
 * The dimmer is a sibling behind the panel, not a parent. WKWebView does not
 * deliver keyboard events to inputs that are descendants of `backdrop-filter`.
 *
 * Usage:
 *   <OverlayBackdrop onClose={handleClose} className="z-[200]">
 *     <div className="rounded-2xl bg-[var(--paper-elevated)] ...">
 *       panel content
 *     </div>
 *   </OverlayBackdrop>
 *
 * The onClose prop is optional — omit it for overlays that don't support backdrop dismiss.
 */

interface OverlayBackdropProps {
  children: ReactNode;
  /** Called when user clicks directly on the backdrop (not on children). Omit to disable backdrop dismiss. */
  onClose?: () => void;
  /** Extra Tailwind classes — primarily for z-index and positioning tweaks (e.g. "z-[200] px-4 overflow-y-auto") */
  className?: string;
  /** Inline styles — for custom animations etc. */
  style?: CSSProperties;
  /** Background opacity variant. Default: "normal" (bg-black/30). "dark" uses bg-black/80 (e.g. image preview). */
  variant?: 'normal' | 'dark';
  /** Portal App-level overlays above page-local stacking contexts so they cover the full shell. */
  portal?: boolean;
}

const OverlayBackdrop = forwardRef<HTMLDivElement, OverlayBackdropProps>(function OverlayBackdrop({
  children,
  onClose,
  className = '',
  style,
  variant = 'normal',
  portal = false,
}, ref) {
  const bg = variant === 'dark' ? 'bg-black/80' : 'bg-black/30';

  const backdrop = (
    <div
      ref={ref}
      data-overlay-backdrop
      data-suppress-browser
      className={`fixed inset-0 flex items-center justify-center ${className}`}
      style={style}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 ${bg} backdrop-blur-sm`}
        onMouseDown={onClose}
      />
      <div className="relative z-10 max-h-full max-w-full">
        {children}
      </div>
    </div>
  );
  return portal && typeof document !== 'undefined'
    ? createPortal(backdrop, document.body)
    : backdrop;
});

export default OverlayBackdrop;
