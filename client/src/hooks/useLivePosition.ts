import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendGeoSample,
  distanceMeters,
  extractGeoSample,
  fuseGeoSamples,
  GeoSample,
  GeoSampleSource,
  isLikelyOutlier,
  projectPosition,
} from '../utils/locationFusion';

export type LivePosition = GeoSample;

export interface StaticCalibrationState {
  status: 'idle' | 'collecting' | 'success' | 'failed';
  progress: number;
  sampleCount: number;
  accuracy: number | null;
  spreadMeters: number | null;
  message: string;
}

interface MotionEstimate {
  speedMps: number;
  bearingDeg: number | null;
}

const MAX_ACCEPTABLE_ACCURACY_M = 45;
const MAX_REASONABLE_SPEED_MPS = 15;
const MAX_PREDICTION_SECONDS = 1.5;
const MAX_PREDICTION_DISTANCE_M = 10;
const MIN_PREDICTION_SPEED_MPS = 0.8;
const PREDICTION_INTERVAL_MS = 100;
const WARM_START_MAX_AGE_MS = 3000;
const WARM_START_TIMEOUT_MS = 8000;
const WATCH_TIMEOUT_MS = 20000;
const NETWORK_MAX_AGE_MS = 15000;
const NETWORK_WATCH_TIMEOUT_MS = 15000;
const MIN_ALPHA = 0.16;
const MAX_ALPHA = 0.82;
const STATIC_CALIBRATION_DURATION_MS = 6500;
const STATIC_CALIBRATION_MIN_SAMPLES = 4;
const STATIC_CALIBRATION_MAX_SPREAD_M = 8;
const STATIC_CALIBRATION_TARGET_ACCURACY_M = 14;
const STATIC_CALIBRATION_MAX_SPEED_MPS = 0.9;

const IDLE_CALIBRATION: StaticCalibrationState = {
  status: 'idle',
  progress: 0,
  sampleCount: 0,
  accuracy: null,
  spreadMeters: null,
  message: '静止補正できます。',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blendNumber(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function blendAltitude(prev: number | null, next: number | null, alpha: number): number | null {
  if (prev === null) return next;
  if (next === null) return prev;
  return blendNumber(prev, next, alpha);
}

function estimateMotion(next: LivePosition, speedFromStep: number): MotionEstimate {
  return {
    speedMps: clamp(next.speed ?? speedFromStep, 0, MAX_REASONABLE_SPEED_MPS),
    bearingDeg: next.heading,
  };
}

function predictPosition(base: LivePosition, motion: MotionEstimate | null, now: number): LivePosition {
  if (!motion || motion.bearingDeg === null || motion.speedMps < MIN_PREDICTION_SPEED_MPS) {
    return base;
  }

  const elapsedSec = clamp((now - base.timestamp) / 1000, 0, MAX_PREDICTION_SECONDS);
  const projectedDistance = motion.speedMps * elapsedSec;
  const maxDistance = Math.min(MAX_PREDICTION_DISTANCE_M, Math.max(base.accuracy * 0.5, 2));
  const distance = Math.min(projectedDistance, maxDistance);

  if (distance <= 0.1) return base;

  const projected = projectPosition(base, distance, motion.bearingDeg);
  return {
    ...projected,
    accuracy: base.accuracy + distance * 0.4,
    timestamp: now,
    speed: motion.speedMps,
    heading: motion.bearingDeg,
  };
}

export function useLivePosition(enabled: boolean) {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<StaticCalibrationState>(IDLE_CALIBRATION);
  const acceptedRef = useRef<LivePosition | null>(null);
  const smoothedRef = useRef<LivePosition | null>(null);
  const displayedRef = useRef<LivePosition | null>(null);
  const motionRef = useRef<MotionEstimate | null>(null);
  const samplesRef = useRef<LivePosition[]>([]);
  const calibrationRef = useRef<StaticCalibrationState>(IDLE_CALIBRATION);
  const calibrationSamplesRef = useRef<GeoSample[]>([]);
  const calibrationStartedAtRef = useRef<number | null>(null);

  const setCalibrationSnapshot = useCallback((next: StaticCalibrationState) => {
    calibrationRef.current = next;
    setCalibration(next);
  }, []);

  const startStaticCalibration = useCallback(() => {
    const next: StaticCalibrationState = {
      status: 'collecting',
      progress: 0,
      sampleCount: 0,
      accuracy: null,
      spreadMeters: null,
      message: '数秒間カメラを動かさないでください。',
    };
    calibrationSamplesRef.current = [];
    calibrationStartedAtRef.current = Date.now();
    setCalibrationSnapshot(next);
  }, [setCalibrationSnapshot]);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }

    acceptedRef.current = null;
    smoothedRef.current = null;
    displayedRef.current = null;
    motionRef.current = null;
    samplesRef.current = [];
    calibrationSamplesRef.current = [];
    calibrationStartedAtRef.current = null;
    setCalibrationSnapshot(IDLE_CALIBRATION);
    setPosition(null);
    setError(null);

    const applyCalibratedPosition = (calibrated: LivePosition) => {
      acceptedRef.current = calibrated;
      smoothedRef.current = calibrated;
      displayedRef.current = calibrated;
      samplesRef.current = appendGeoSample(samplesRef.current, calibrated, 12000, 8);
      motionRef.current =
        calibrated.heading !== null && calibrated.speed !== null
          ? { speedMps: calibrated.speed, bearingDeg: calibrated.heading }
          : null;
      setPosition(calibrated);
    };

    const updateStaticCalibration = (candidate: GeoSample) => {
      const current = calibrationRef.current;
      if (current.status !== 'collecting') return;

      const startedAt = calibrationStartedAtRef.current ?? Date.now();
      const elapsedMs = Date.now() - startedAt;
      calibrationSamplesRef.current = appendGeoSample(
        calibrationSamplesRef.current,
        candidate,
        STATIC_CALIBRATION_DURATION_MS + 1500,
        20,
      );

      const fused = fuseGeoSamples(calibrationSamplesRef.current);
      const isMoving =
        candidate.speed !== null && candidate.speed > STATIC_CALIBRATION_MAX_SPEED_MPS;
      const progress = clamp(elapsedMs / STATIC_CALIBRATION_DURATION_MS, 0, 1);
      const candidateState: StaticCalibrationState = {
        status: 'collecting',
        progress,
        sampleCount: fused.sampleCount,
        accuracy: fused.sample.accuracy,
        spreadMeters: fused.spreadMeters,
        message: isMoving ? '動きを検知しました。止まってください。' : '安定した位置サンプルを収集中...',
      };

      if (progress < 1) {
        setCalibrationSnapshot(candidateState);
        return;
      }

      const hasEnoughSamples = fused.sampleCount >= STATIC_CALIBRATION_MIN_SAMPLES;
      const isTightEnough = fused.spreadMeters <= STATIC_CALIBRATION_MAX_SPREAD_M;
      const isAccurateEnough = fused.sample.accuracy <= STATIC_CALIBRATION_TARGET_ACCURACY_M;

      if (hasEnoughSamples && isTightEnough && isAccurateEnough && !isMoving) {
        const calibrated: LivePosition = {
          ...fused.sample,
          speed: 0,
          accuracy: Math.min(fused.sample.accuracy, Math.max(3, fused.spreadMeters * 1.2)),
          timestamp: Date.now(),
        };
        applyCalibratedPosition(calibrated);
        setCalibrationSnapshot({
          status: 'success',
          progress: 1,
          sampleCount: fused.sampleCount,
          accuracy: calibrated.accuracy,
          spreadMeters: fused.spreadMeters,
          message: '静止キャリブレーション完了。',
        });
        return;
      }

      setCalibrationSnapshot({
        status: 'failed',
        progress: 1,
        sampleCount: fused.sampleCount,
        accuracy: fused.sample.accuracy,
        spreadMeters: fused.spreadMeters,
        message: '補正失敗。空が見える場所で静止して再試行してください。',
      });
    };

    let hasAnyFix = false;

    const handleSuccess = (source: GeoSampleSource) => (positionFix: GeolocationPosition) => {
      hasAnyFix = true;
      const candidate = extractGeoSample(positionFix, source);
      const prevAccepted = acceptedRef.current;
      const prevSmoothed = smoothedRef.current;

      if (prevAccepted && isLikelyOutlier(candidate, prevAccepted, MAX_REASONABLE_SPEED_MPS)) {
        setError(null);
        return;
      }

      if (candidate.accuracy > MAX_ACCEPTABLE_ACCURACY_M && prevAccepted && candidate.accuracy >= prevAccepted.accuracy) {
        setError(null);
        return;
      }

      samplesRef.current = appendGeoSample(samplesRef.current, candidate, 12000, 8);
      const fused = fuseGeoSamples(samplesRef.current).sample;
      updateStaticCalibration(candidate);

      if (!prevAccepted || !prevSmoothed) {
        acceptedRef.current = fused;
        smoothedRef.current = fused;
        displayedRef.current = fused;
        motionRef.current =
          fused.heading !== null && fused.speed !== null
            ? { speedMps: fused.speed, bearingDeg: fused.heading }
            : null;
        setPosition(fused);
        setError(null);
        return;
      }

      const dtSec = Math.max((fused.timestamp - prevSmoothed.timestamp) / 1000, 0.001);
      const fusedJumpMeters = distanceMeters(prevSmoothed, fused);
      const speedFromStep = fusedJumpMeters / dtSec;
      const isStationary = fused.speed !== null ? fused.speed < 0.8 : speedFromStep < 0.8;
      const jitterRadiusM = clamp(Math.max(prevSmoothed.accuracy, fused.accuracy) * 0.25, 2.5, 12);

      let alpha = fusedJumpMeters <= jitterRadiusM ? 0.18 : 0.42;
      if (fused.accuracy <= 8) alpha += 0.22;
      else if (fused.accuracy <= 15) alpha += 0.14;
      if (!isStationary) alpha += 0.12;
      if (fusedJumpMeters > fused.accuracy) alpha += 0.1;
      alpha = clamp(alpha, MIN_ALPHA, MAX_ALPHA);

      const smoothed: LivePosition = {
        lat: blendNumber(prevSmoothed.lat, fused.lat, alpha),
        lng: blendNumber(prevSmoothed.lng, fused.lng, alpha),
        altitude: blendAltitude(prevSmoothed.altitude, fused.altitude, alpha),
        accuracy: blendNumber(prevSmoothed.accuracy, fused.accuracy, isStationary ? 0.22 : 0.35),
        timestamp: fused.timestamp,
        speed: fused.speed ?? speedFromStep,
        heading: fused.heading,
      };

      acceptedRef.current = fused;
      smoothedRef.current = smoothed;
      motionRef.current = estimateMotion(smoothed, speedFromStep);

      const predictedNow = predictPosition(smoothed, motionRef.current, Date.now());
      displayedRef.current = predictedNow;
      setPosition(predictedNow);
      setError(null);
    };

    const handleError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED || !hasAnyFix) {
        setError(err.message || `code ${err.code}`);
      }
    };

    navigator.geolocation.getCurrentPosition(handleSuccess('gps'), handleError, {
      enableHighAccuracy: true,
      maximumAge: WARM_START_MAX_AGE_MS,
      timeout: WARM_START_TIMEOUT_MS,
    });

    navigator.geolocation.getCurrentPosition(handleSuccess('network'), handleError, {
      enableHighAccuracy: false,
      maximumAge: NETWORK_MAX_AGE_MS,
      timeout: WARM_START_TIMEOUT_MS,
    });

    const watchIds = [
      navigator.geolocation.watchPosition(handleSuccess('gps'), handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: WATCH_TIMEOUT_MS,
      }),
      navigator.geolocation.watchPosition(handleSuccess('network'), handleError, {
        enableHighAccuracy: false,
        maximumAge: NETWORK_MAX_AGE_MS,
        timeout: NETWORK_WATCH_TIMEOUT_MS,
      }),
    ];

    return () => {
      for (const watchId of watchIds) {
        navigator.geolocation.clearWatch(watchId);
      }
      acceptedRef.current = null;
      smoothedRef.current = null;
      displayedRef.current = null;
      motionRef.current = null;
      samplesRef.current = [];
      calibrationSamplesRef.current = [];
      calibrationStartedAtRef.current = null;
    };
  }, [enabled, setCalibrationSnapshot]);

  useEffect(() => {
    if (!enabled) return;

    const timerId = window.setInterval(() => {
      const base = smoothedRef.current;
      if (!base) return;

      const next = predictPosition(base, motionRef.current, Date.now());
      const prevDisplayed = displayedRef.current;

      if (prevDisplayed && distanceMeters(prevDisplayed, next) < 0.25) return;

      displayedRef.current = next;
      setPosition(next);
    }, PREDICTION_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [enabled]);

  return { position, error, calibration, startStaticCalibration };
}
