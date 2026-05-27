import { LocationDiagnostics, LocationFixMode, LocationSignal } from '../types';
import {
  appendGeoSample,
  extractGeoSample,
  fuseGeoSamples,
  GeoFusionResult,
  GeoSample,
  GeoSampleSource,
  isLikelyOutlier,
} from './locationFusion';

interface NetworkInformationLike {
  type?: string;
  effectiveType?: string;
}

type NavigatorWithSignals = Navigator & {
  bluetooth?: unknown;
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

export interface HybridLocationFix {
  sample: GeoSample;
  diagnostics: LocationDiagnostics;
}

export interface HybridLocationOptions {
  targetAccuracyM: number;
  goodAccuracyM: number;
  minGoodSamples: number;
  maxWaitMs: number;
  warmStartMaxAgeMs: number;
  warmStartTimeoutMs: number;
  onAccuracy?: (accuracy: number) => void;
}

const NETWORK_MAX_AGE_MS = 15000;
const NETWORK_WARM_TIMEOUT_MS = 5000;
const NETWORK_WATCH_TIMEOUT_MS = 15000;

function getNetworkInfo(): NetworkInformationLike | undefined {
  const nav = navigator as NavigatorWithSignals;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function hasBluetoothApi(): boolean {
  return 'bluetooth' in (navigator as NavigatorWithSignals);
}

function getFixMode(sources: GeoSampleSource[]): LocationFixMode {
  const hasGps = sources.includes('gps');
  const hasNetwork = sources.includes('network');
  if (hasGps && hasNetwork) return 'hybrid';
  if (hasNetwork) return 'network';
  return 'gps';
}

export function createLocationDiagnostics(result: GeoFusionResult): LocationDiagnostics {
  const networkInfo = getNetworkInfo();
  // Browsers expose Wi-Fi/cell positioning only through Geolocation.
  const consideredSignals: LocationSignal[] = ['gps', 'wifi', 'mobile_network'];
  const unavailableSignals: LocationSignal[] = [];

  if (hasBluetoothApi()) {
    consideredSignals.push('bluetooth');
  } else {
    unavailableSignals.push('bluetooth');
  }

  return {
    fixMode: getFixMode(result.sources),
    sampleCount: result.sampleCount,
    spreadMeters: result.spreadMeters,
    consideredSignals,
    unavailableSignals,
    networkType: networkInfo?.type ?? networkInfo?.effectiveType ?? null,
  };
}

export function collectHybridLocation(options: HybridLocationOptions): Promise<HybridLocationFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    let samples: GeoSample[] = [];
    let bestResult: GeoFusionResult | null = null;
    let finished = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const watchIds: number[] = [];
    let lastError: GeolocationPositionError | Error | null = null;

    const cleanup = () => {
      for (const watchId of watchIds) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
    };

    const finish = (fallbackError?: GeolocationPositionError | Error) => {
      if (finished) return;
      finished = true;
      cleanup();

      if (!bestResult) {
        reject(fallbackError ?? lastError ?? new Error('No location fix obtained'));
        return;
      }

      resolve({
        sample: bestResult.sample,
        diagnostics: createLocationDiagnostics(bestResult),
      });
    };

    const handleSample = (source: GeoSampleSource) => (positionFix: GeolocationPosition) => {
      if (finished) return;

      const candidate = extractGeoSample(positionFix, source);
      const previousBest = bestResult?.sample ?? null;
      if (previousBest && isLikelyOutlier(candidate, previousBest)) return;

      samples = appendGeoSample(samples, candidate, 15000, 12);
      bestResult = fuseGeoSamples(samples);
      options.onAccuracy?.(bestResult.sample.accuracy);

      const goodSampleCount = samples.filter(
        (sample) => sample.accuracy <= options.goodAccuracyM,
      ).length;
      if (
        bestResult.sample.accuracy <= options.targetAccuracyM &&
        goodSampleCount >= options.minGoodSamples
      ) {
        finish();
      }
    };

    const handleError = (err: GeolocationPositionError) => {
      if (finished) return;
      lastError = err;
      if (err.code === err.PERMISSION_DENIED) {
        finish(err);
      }
    };

    navigator.geolocation.getCurrentPosition(handleSample('gps'), () => {}, {
      enableHighAccuracy: true,
      maximumAge: options.warmStartMaxAgeMs,
      timeout: options.warmStartTimeoutMs,
    });

    navigator.geolocation.getCurrentPosition(handleSample('network'), () => {}, {
      enableHighAccuracy: false,
      maximumAge: NETWORK_MAX_AGE_MS,
      timeout: NETWORK_WARM_TIMEOUT_MS,
    });

    watchIds.push(
      navigator.geolocation.watchPosition(handleSample('gps'), handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: options.maxWaitMs,
      }),
    );

    watchIds.push(
      navigator.geolocation.watchPosition(handleSample('network'), handleError, {
        enableHighAccuracy: false,
        maximumAge: NETWORK_MAX_AGE_MS,
        timeout: NETWORK_WATCH_TIMEOUT_MS,
      }),
    );

    timeoutId = setTimeout(() => finish(), options.maxWaitMs);
  });
}
