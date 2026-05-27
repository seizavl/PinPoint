import { useCallback, useEffect, useState } from 'react';

export interface LiveOrientation {
  heading: number | null;   // 0-360, 北=0, 時計回り
  beta: number | null;
  gamma: number | null;
}

export function useLiveOrientation(enabled: boolean) {
  const [orientation, setOrientation] = useState<LiveOrientation>({
    heading: null,
    beta: null,
    gamma: null,
  });

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DoE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DoE.requestPermission === 'function') {
      const result = await DoE.requestPermission();
      return result === 'granted';
    }
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
      }).webkitCompassHeading;

      let heading: number | null;
      if (typeof webkitHeading === 'number') {
        heading = webkitHeading;
      } else if (e.absolute && e.alpha !== null) {
        heading = (360 - e.alpha) % 360;
      } else {
        heading = e.alpha;
      }

      setOrientation({ heading, beta: e.beta, gamma: e.gamma });
    };

    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    const eventName = hasAbsolute ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(eventName, handler as EventListener, true);
    return () => window.removeEventListener(eventName, handler as EventListener, true);
  }, [enabled]);

  return { orientation, requestPermission };
}
