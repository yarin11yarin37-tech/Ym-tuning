import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../i18n';

interface Props {
  value: number; // 0..1
  onChange: (v: number) => void;
  onStop: () => void;
}

/**
 * Virtual accelerator. Purely a UI input for the simulator — it has no path to the vehicle.
 * Mouse / touch / pen: press and drag; releasing the pointer lets the pedal spring back to 0,
 * like a real pedal. Keyboard: ↑/↓ ±10%, PageUp/PageDown ±25%, Home 0, End 100%,
 * hold Space for full throttle, Escape stops and resets.
 */
export function Pedal({ value, onChange, onStop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const spaceHeld = useRef<number | null>(null);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const v = 1 - (e.clientY - r.top) / r.height;
    onChange(Math.min(1, Math.max(0, v)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (d: number) => onChange(Math.min(1, Math.max(0, Math.round((value + d) * 100) / 100)));
    switch (e.key) {
      case 'ArrowUp': step(0.1); break;
      case 'ArrowDown': step(-0.1); break;
      case 'PageUp': step(0.25); break;
      case 'PageDown': step(-0.25); break;
      case 'Home': onChange(0); break;
      case 'End': onChange(1); break;
      case ' ':
        if (spaceHeld.current === null) spaceHeld.current = value;
        onChange(1);
        break;
      case 'Escape': onStop(); break;
      default: return;
    }
    e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' && spaceHeld.current !== null) {
      onChange(spaceHeld.current);
      spaceHeld.current = null;
      e.preventDefault();
    }
  };

  const pct = Math.round(value * 100);
  return (
    <div className="pedal-wrap">
      <div
        ref={ref}
        className={`pedal${dragging ? ' is-active' : ''}`}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('lab.pedal.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={t('lab.pedal.value', { n: pct })}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging && fromPointer(e)}
        onPointerUp={() => {
          setDragging(false);
          onChange(0);
        }}
        onPointerCancel={() => {
          setDragging(false);
          onChange(0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => {
          if (spaceHeld.current !== null) {
            onChange(spaceHeld.current);
            spaceHeld.current = null;
          }
        }}
      >
        <div className="pedal__fill" style={{ height: `${pct}%` }} />
        <div className="pedal__ribs" aria-hidden="true" />
        <div className="pedal__value num">{pct}%</div>
      </div>
      <div className="pedal__label">{t('lab.pedal.label')}</div>
      <p className="pedal__hint">{t('lab.pedal.hint')}</p>
    </div>
  );
}
