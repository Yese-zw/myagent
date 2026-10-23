import type { RuntimeType } from '../../shared/types/runtime';
import { useProductLogo } from '@/features/account/useProductLogo';
import { RUNTIME_PRESENTATION } from './runtimePresentation';

/** Integrated runtimes pair LSAGENT with their engine; external CLIs use their own mark. */
export default function RuntimeIcon({ type, size = 20 }: { type: RuntimeType; size?: number }) {
  const product = useProductLogo(RUNTIME_PRESENTATION.builtin.icon);
  const { icon, engineIcon } = RUNTIME_PRESENTATION[type];
  const usesSiteLogo = type === 'builtin' || type === 'dsh';
  const mark = usesSiteLogo ? product.src : icon;
  if (!engineIcon) {
    return <img src={mark} alt="" className="shrink-0 rounded-[23%]" style={{ width: size, height: size }} draggable={false} onError={usesSiteLogo ? product.onError : undefined} />;
  }

  const tileStyle = { width: size, height: size, borderRadius: '23%' };
  return (
    <span aria-hidden="true" className="relative inline-block shrink-0 align-middle" style={{ width: size * 1.74, height: size }}>
      <span className="absolute left-0 top-0 overflow-hidden bg-[#212121]" style={{ ...tileStyle, transform: 'rotate(-5deg)' }}>
        <img src={mark} alt="" className="h-full w-full object-contain" draggable={false} onError={usesSiteLogo ? product.onError : undefined} />
      </span>
      <span
        className={`absolute top-0 z-[1] flex items-center justify-center overflow-hidden ${type === 'builtin' ? 'bg-[#e9704b]' : 'bg-[#e9e9e7]'}`}
        style={{
          ...tileStyle,
          left: size * 0.74,
          transform: 'rotate(5deg)',
          // The cut follows the containing row, including its selected and hover surfaces.
          boxShadow: `0 0 0 ${size * 0.055}px var(--runtime-icon-surface, var(--paper-elevated)), 0 0 0 ${size * 0.055}px var(--paper-elevated)`,
        }}
      >
        <img src={engineIcon} alt="" className="h-full w-full object-contain" draggable={false} />
      </span>
    </span>
  );
}
