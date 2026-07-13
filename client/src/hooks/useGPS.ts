import { useCallback, useState } from 'react';
import { GPSPayload, LocationDiagnostics, SendStatus } from '../types';
import { collectHybridLocation } from '../utils/positioning';

function getUserId(): string {
  const stored = localStorage.getItem('pinpoint_user_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('pinpoint_user_id', id);
  return id;
}

const TARGET_ACCURACY_M = 12;
const GOOD_ACCURACY_M = 18;
const MIN_GOOD_SAMPLES = 3;
const MAX_WAIT_MS = 25000;
const WARM_START_MAX_AGE_MS = 3000;
const WARM_START_TIMEOUT_MS = 6000;

export function useGPS() {
  const [status, setStatus] = useState<SendStatus>('idle');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<LocationDiagnostics | null>(null);

  const getGPS = useCallback((): Promise<GPSPayload> => {
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
      return {
        userId: getUserId(),
        type: 'gps' as const,
        lat: sample.lat,
        lng: sample.lng,
        altitude: sample.altitude,
        altitudeAccuracy: sample.altitudeAccuracy,
        accuracy: sample.accuracy,
        timestamp: sample.timestamp,
        diagnostics,
      };
    });
  }, []);

  return { status, setStatus, accuracy, diagnostics, getGPS };
}
