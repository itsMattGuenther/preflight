import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focus'];

// True once nobody has moved the mouse, touched, typed or scrolled on the page
// for `ms`, so a briefing left open on a desk stops polling free, rate-limited
// sources (live traffic). Any activity, or calling wake(), makes it false.
export function useIdle(ms) {
  const [idle, setIdle] = useState(false);
  const last = useRef(Date.now());

  const wake = useCallback(() => {
    last.current = Date.now();
    setIdle(false);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    ACTIVITY.forEach((name) => window.addEventListener(name, wake, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => {
      if (Date.now() - last.current >= ms) setIdle(true);
    }, 15 * 1000);
    return () => {
      ACTIVITY.forEach((name) => window.removeEventListener(name, wake));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [ms, wake]);

  return [idle, wake];
}
