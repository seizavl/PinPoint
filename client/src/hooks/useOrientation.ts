import { useCallback, useRef, useState } from 'react';
import { LocationDiagnostics, WorldCoordPayload, SendStatus } from '../types';
import { collectHybridLocation } from '../utils/positioning';

function getUserId(): string {
  const stored = localStorage.getItem('disaster_ar_user_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('disaster_ar_user_id', id);
  return id;
}

type OrientationData = { alpha: number | null; beta: number | null; gamma: number | null };

const TARGET_ACCURACY_M = 12;
const GOOD_ACCURACY_M = 18;
const MIN_GOOD_SAMPLES = 3;
const MAX_WAIT_MS = 25000;
const WARM_START_MAX_AGE_MS = 3000;
const WARM_START_TIMEOUT_MS = 6000;

export function useOrientation() {
  const [status, setStatus] = useState<SendStatus>('idle');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<LocationDiagnostics | null>(null);
  const orientationRef = useRef<OrientationData>({ alpha: null, beta: null, gamma: null });
  const listenerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

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

  const startListening = useCallback(() => {
    if (listenerRef.current) return;

    const handler = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
      }).webkitCompassHeading;

      let alpha: number | null;
      if (typeof webkitHeading === 'number') {
        alpha = webkitHeading;
      } else if (e.absolute && e.alpha !== null) {
        alpha = (360 - e.alpha) % 360;
      } else {
        alpha = e.alpha;
      }

      orientationRef.current = { alpha, beta: e.beta, gamma: e.gamma };
    };

    listenerRef.current = handler;
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handler as EventListener, true);
    }
    window.addEventListener('deviceorientation', handler, true);
  }, []);

  const getWorldCoord = useCallback((): Promise<WorldCoordPayload> => {
    return collectHybridLocation({
      targetAccuracyM: TARGET_ACCURACY_M,
      goodAccuracyM: GOOD_ACCURACY_M,
      minGoodSamples: MIN_GOOD_SAMPLES,
      maxWaitMs: MAX_WAIT_MS,
      warmStartMaxAgeMs: WARM_START_MAX_AGE_MS,
      warmStartTimeoutMs: WARM_START_TIMEOUT_MS,
      onAccuracy: setAccuracy,
    }).then(({ sample, diagnostics }) => {
      setDiagnostics(diagnostics);
      const { alpha, beta, gamma } = orientationRef.current;
      return {
        userId: getUserId(),
        type: 'world' as const,
        lat: sample.lat,
        lng: sample.lng,
        altitude: sample.altitude,
        accuracy: sample.accuracy,
        alpha,
        beta,
        gamma,
        timestamp: sample.timestamp,
        diagnostics,
      };
    });
  }, []);

  return {
    status,
    setStatus,
    accuracy,
    diagnostics,
    requestPermission,
    startListening,
    getWorldCoord,
  };
}
