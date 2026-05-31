import React, { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useUiPreferences } from '../context/UiPreferencesContext';

const polygonCollapsed = (cx, cy, vertexCount) => {
  const pairs = Array.from({ length: vertexCount }, () => `${cx}px ${cy}px`).join(', ');
  return `polygon(${pairs})`;
};

export const getThemeTransitionClipPaths = (variant, cx, cy, maxRadius, viewportWidth, viewportHeight) => {
  switch (variant) {
    case 'square': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [
        `${cx - halfSide}px ${cy - halfSide}px`,
        `${cx + halfSide}px ${cy - halfSide}px`,
        `${cx + halfSide}px ${cy + halfSide}px`,
        `${cx - halfSide}px ${cy + halfSide}px`
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'triangle': {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [
        `${cx}px ${cy - scale}px`,
        `${cx + dx}px ${cy + 0.5 * scale}px`,
        `${cx - dx}px ${cy + 0.5 * scale}px`
      ].join(', ');
      return [polygonCollapsed(cx, cy, 3), `polygon(${verts})`];
    }
    case 'diamond': {
      const radius = maxRadius * Math.SQRT2;
      const end = [
        `${cx}px ${cy - radius}px`,
        `${cx + radius}px ${cy}px`,
        `${cx}px ${cy + radius}px`,
        `${cx - radius}px ${cy}px`
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'hexagon': {
      const radius = maxRadius * Math.SQRT2;
      const verts = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 3;
        verts.push(`${cx + radius * Math.cos(angle)}px ${cy + radius * Math.sin(angle)}px`);
      }
      return [polygonCollapsed(cx, cy, 6), `polygon(${verts.join(', ')})`];
    }
    case 'rectangle': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const end = [
        `${cx - halfW}px ${cy - halfH}px`,
        `${cx + halfW}px ${cy - halfH}px`,
        `${cx + halfW}px ${cy + halfH}px`,
        `${cx - halfW}px ${cy + halfH}px`
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'star': {
      const radius = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (r) => {
        const verts = [];
        for (let i = 0; i < 5; i += 1) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(`${cx + r * Math.cos(outerA)}px ${cy + r * Math.sin(outerA)}px`);
          const innerA = outerA + Math.PI / 5;
          verts.push(`${cx + r * innerRatio * Math.cos(innerA)}px ${cy + r * innerRatio * Math.sin(innerA)}px`);
        }
        return `polygon(${verts.join(', ')})`;
      };
      return [starPolygon(Math.max(2, radius * 0.025)), starPolygon(radius)];
    }
    case 'circle':
    default:
      return [
        `circle(0px at ${cx}px ${cy}px)`,
        `circle(${maxRadius}px at ${cx}px ${cy}px)`
      ];
  }
};

const syncRootThemeClass = (mode) => {
  const root = document.documentElement;
  root.classList.toggle('theme-dark', mode === 'dark');
  root.classList.toggle('theme-light', mode !== 'dark');
  try {
    localStorage.setItem('cets_color_mode', mode);
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
};

const AnimatedThemeToggler = React.forwardRef(({
  className = '',
  duration = 480,
  variant = 'circle',
  fromCenter = false,
  label,
  ...props
}, forwardedRef) => {
  const { colorMode, setColorMode } = useUiPreferences();
  const buttonRef = useRef(null);
  const isDark = colorMode === 'dark';

  const setButtonRef = useCallback((node) => {
    buttonRef.current = node;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  }, [forwardedRef]);

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const { top, left, width, height } = button.getBoundingClientRect();
    const x = fromCenter ? viewportWidth / 2 : left + width / 2;
    const y = fromCenter ? viewportHeight / 2 : top + height / 2;
    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y)
    );
    const nextMode = isDark ? 'light' : 'dark';

    const applyTheme = () => {
      flushSync(() => {
        syncRootThemeClass(nextMode);
        setColorMode(nextMode);
      });
    };

    if (typeof document.startViewTransition !== 'function') {
      applyTheme();
      return;
    }

    const root = document.documentElement;
    root.dataset.magicuiThemeVt = 'active';
    root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`);

    const cleanup = () => {
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty('--magicui-theme-toggle-vt-duration');
    };

    const transition = document.startViewTransition(applyTheme);
    if (typeof transition.finished?.finally === 'function') {
      transition.finished.finally(cleanup);
    } else {
      cleanup();
    }

    transition.ready?.then?.(() => {
      const clipPath = getThemeTransitionClipPaths(
        variant,
        x,
        y,
        maxRadius,
        viewportWidth,
        viewportHeight
      );

      root.animate(
        { clipPath },
        {
          duration,
          easing: variant === 'star' ? 'linear' : 'ease-in-out',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    });
  }, [duration, fromCenter, isDark, setColorMode, variant]);

  return (
    <button
      type="button"
      ref={setButtonRef}
      className={className}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      {...props}
    >
      <span className="animated-theme-toggle-icon" aria-hidden="true">
        {isDark ? <SunOutlined /> : <MoonOutlined />}
      </span>
      {label ? <span className="animated-theme-toggle-label">{label}</span> : <span className="sr-only">Toggle theme</span>}
    </button>
  );
});

AnimatedThemeToggler.displayName = 'AnimatedThemeToggler';

export default AnimatedThemeToggler;
