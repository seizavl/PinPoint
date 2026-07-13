import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendGeoSample,
  distanceMeters,
  extractGeoSample,
  fromLocalMeters,
  fuseGeoSamples,
  GeoSample,
  GeoSampleSource,
  isLikelyOutlier,
  projectPosition,
  toLocalMeters,
} from '../utils/locationFusion';
import { StepDetector } from '../utils/stepDetector';

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
// カメラ側の位置更新周期: 1秒に1回
const PUBLISH_INTERVAL_MS = 1000;
// この精度(m)より悪いGPSフィックスは「室内品質」とみなし、PDRを優先する
const INDOOR_ACCURACY_M = 30;
// この精度(m)以下なら良好なGPSとみなし、屋内モードを解除する
const GOOD_GPS_ACCURACY_M = 25;
// 良好なGPSがこの時間(ms)途絶えたら屋内モードと判定
const INDOOR_MODE_TIMEOUT_MS = 10000;
// PDR中の精度上限 (これ以上は悪化させない、水平カルマンの分散上限として使用)
const PDR_MAX_ACCURACY_M = 40;
// PDR1歩あたりに水平カルマンの分散へ加算する係数 (歩幅[m] × この値 = 分散[m^2])
const PDR_STEP_VARIANCE_COEFF = 0.3;
// 水平カルマンフィルタ: 速度に応じたプロセスノイズ係数。毎秒 (max(speed, 下限) × この値)^2 を分散に加算
const HORIZONTAL_SPEED_NOISE_COEFF = 1.5;
// 水平カルマンフィルタ: プロセスノイズ計算で使う速度の下限 (静止時のドリフトを確保する)
const HORIZONTAL_MIN_NOISE_SPEED_MPS = 0.5;
// 室内品質GPSで「歩いていないのに飛んだ」ジャンプを検知した際の観測ノイズ倍率
const INDOOR_JUMP_NOISE_MULTIPLIER = 25;
// 室内品質GPSでジャンプ判定に満たない場合でも適用する観測ノイズ倍率
const INDOOR_DEFAULT_NOISE_MULTIPLIER = 4;
// 高度カルマンフィルタ: 毎秒分散に加算するプロセスノイズ (m^2)
const ALTITUDE_PROCESS_NOISE_PER_SEC = 0.5;
// 表示用accuracy/altitudeAccuracyの下限 (m)
const MIN_DISPLAY_ACCURACY_M = 3;
const WARM_START_MAX_AGE_MS = 3000;
const WARM_START_TIMEOUT_MS = 8000;
const WATCH_TIMEOUT_MS = 20000;
const NETWORK_MAX_AGE_MS = 15000;
const NETWORK_WATCH_TIMEOUT_MS = 15000;
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

// 水平位置(緯度経度)の推定状態。原点(基準点)からの東西/南北メートル座標で位置を持つ
// 定位置カルマンフィルタ(等方分散を仮定するスカラーP)。
interface HorizontalKalmanState {
  originLat: number;
  originLng: number;
  east: number;
  north: number;
  variance: number;
}

// 高度の推定状態。1次元スカラーカルマンフィルタ。
interface AltitudeKalmanState {
  altitude: number;
  variance: number;
}

function initHorizontalKalman(origin: Pick<GeoSample, 'lat' | 'lng'>, accuracy: number): HorizontalKalmanState {
  return {
    originLat: origin.lat,
    originLng: origin.lng,
    east: 0,
    north: 0,
    variance: clamp(accuracy, MIN_DISPLAY_ACCURACY_M, 100) ** 2,
  };
}

function initAltitudeKalman(altitude: number, altitudeAccuracy: number | null): AltitudeKalmanState {
  return {
    altitude,
    variance: clamp(altitudeAccuracy ?? 30, MIN_DISPLAY_ACCURACY_M, 100) ** 2,
  };
}

// 水平カルマンフィルタの現在の推定位置を緯度経度として取り出す
function horizontalKalmanLatLng(state: HorizontalKalmanState): { lat: number; lng: number } {
  return fromLocalMeters(
    { lat: state.originLat, lng: state.originLng },
    { east: state.east, north: state.north },
  );
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

export function useLivePosition(enabled: boolean, headingDeg: number | null = null) {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<StaticCalibrationState>(IDLE_CALIBRATION);
  const [isIndoorMode, setIsIndoorMode] = useState(false);
  const acceptedRef = useRef<LivePosition | null>(null);
  const smoothedRef = useRef<LivePosition | null>(null);
  const displayedRef = useRef<LivePosition | null>(null);
  const motionRef = useRef<MotionEstimate | null>(null);
  const samplesRef = useRef<LivePosition[]>([]);
  const calibrationRef = useRef<StaticCalibrationState>(IDLE_CALIBRATION);
  const calibrationSamplesRef = useRef<GeoSample[]>([]);
  const calibrationStartedAtRef = useRef<number | null>(null);
  const headingRef = useRef<number | null>(null);
  const walkedSinceBlendRef = useRef(0);
  const lastStepAtRef = useRef(0);
  const lastGoodGpsAtRef = useRef(0);
  const horizontalKalmanRef = useRef<HorizontalKalmanState | null>(null);
  const altitudeKalmanRef = useRef<AltitudeKalmanState | null>(null);

  useEffect(() => {
    headingRef.current = headingDeg;
  }, [headingDeg]);

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
    walkedSinceBlendRef.current = 0;
    lastStepAtRef.current = 0;
    lastGoodGpsAtRef.current = 0;
    horizontalKalmanRef.current = null;
    altitudeKalmanRef.current = null;
    setCalibrationSnapshot(IDLE_CALIBRATION);
    setIsIndoorMode(false);
    setPosition(null);
    setError(null);

    const applyCalibratedPosition = (calibrated: LivePosition) => {
      acceptedRef.current = calibrated;
      smoothedRef.current = calibrated;
      displayedRef.current = calibrated;
      samplesRef.current = appendGeoSample(samplesRef.current, calibrated, 12000, 8);
      // 静止キャリブレーション成功時はカルマン状態(原点・分散)をキャリブ値でリセットする
      horizontalKalmanRef.current = initHorizontalKalman(calibrated, calibrated.accuracy);
      altitudeKalmanRef.current =
        calibrated.altitude !== null
          ? initAltitudeKalman(calibrated.altitude, calibrated.altitudeAccuracy)
          : null;
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

      if (!prevAccepted || !prevSmoothed || !horizontalKalmanRef.current) {
        acceptedRef.current = fused;
        smoothedRef.current = fused;
        displayedRef.current = fused;
        horizontalKalmanRef.current = initHorizontalKalman(fused, fused.accuracy);
        altitudeKalmanRef.current =
          fused.altitude !== null ? initAltitudeKalman(fused.altitude, fused.altitudeAccuracy) : null;
        motionRef.current =
          fused.heading !== null && fused.speed !== null
            ? { speedMps: fused.speed, bearingDeg: fused.heading }
            : null;
        setPosition(fused);
        setError(null);
        return;
      }

      if (fused.accuracy <= GOOD_GPS_ACCURACY_M) {
        lastGoodGpsAtRef.current = Date.now();
      }

      const horizontalKalman = horizontalKalmanRef.current;
      const dtSec = Math.max((fused.timestamp - prevSmoothed.timestamp) / 1000, 0.001);
      const prevFilterLatLng = horizontalKalmanLatLng(horizontalKalman);
      const fusedJumpMeters = distanceMeters(prevFilterLatLng, fused);
      const speedFromStep = fusedJumpMeters / dtSec;

      // --- 水平カルマンフィルタ: 予測(プロセスノイズ加算) ---
      const noiseSpeed = Math.max(fused.speed ?? speedFromStep, HORIZONTAL_MIN_NOISE_SPEED_MPS);
      horizontalKalman.variance += (noiseSpeed * HORIZONTAL_SPEED_NOISE_COEFF) ** 2 * dtSec;

      // --- 水平カルマンフィルタ: 観測更新 ---
      // 室内品質のGPSは「実際に歩いた距離」でゲーティングする:
      // 歩いていないのに位置が飛ぶのはWi-Fi測位のジッタなので、観測ノイズを大きくしてほぼ無視する。
      const isPoorFix = fused.accuracy > INDOOR_ACCURACY_M;
      let measurementVariance = clamp(fused.accuracy, MIN_DISPLAY_ACCURACY_M, 100) ** 2;
      if (isPoorFix) {
        const allowedMoveM = walkedSinceBlendRef.current + Math.max(4, fused.accuracy * 0.25);
        measurementVariance *=
          fusedJumpMeters > allowedMoveM ? INDOOR_JUMP_NOISE_MULTIPLIER : INDOOR_DEFAULT_NOISE_MULTIPLIER;
      }
      walkedSinceBlendRef.current = 0;

      const measured = toLocalMeters(
        { lat: horizontalKalman.originLat, lng: horizontalKalman.originLng },
        fused,
      );
      const horizontalGain =
        horizontalKalman.variance / (horizontalKalman.variance + measurementVariance);
      horizontalKalman.east += horizontalGain * (measured.east - horizontalKalman.east);
      horizontalKalman.north += horizontalGain * (measured.north - horizontalKalman.north);
      horizontalKalman.variance *= 1 - horizontalGain;

      // --- 高度カルマンフィルタ: 予測(常時) + 観測更新(altitudeがnullなら予測のみ) ---
      if (altitudeKalmanRef.current) {
        altitudeKalmanRef.current.variance += ALTITUDE_PROCESS_NOISE_PER_SEC * dtSec;
      }
      if (fused.altitude !== null) {
        if (!altitudeKalmanRef.current) {
          altitudeKalmanRef.current = initAltitudeKalman(fused.altitude, fused.altitudeAccuracy);
        } else {
          const altitudeKalman = altitudeKalmanRef.current;
          const altitudeMeasurementVariance = clamp(
            fused.altitudeAccuracy ?? 30,
            MIN_DISPLAY_ACCURACY_M,
            100,
          ) ** 2;
          const altitudeGain =
            altitudeKalman.variance / (altitudeKalman.variance + altitudeMeasurementVariance);
          altitudeKalman.altitude += altitudeGain * (fused.altitude - altitudeKalman.altitude);
          altitudeKalman.variance *= 1 - altitudeGain;
        }
      }

      const { lat, lng } = horizontalKalmanLatLng(horizontalKalman);
      const smoothed: LivePosition = {
        lat,
        lng,
        altitude: altitudeKalmanRef.current?.altitude ?? null,
        altitudeAccuracy: altitudeKalmanRef.current
          ? Math.max(MIN_DISPLAY_ACCURACY_M, Math.sqrt(altitudeKalmanRef.current.variance))
          : null,
        accuracy: Math.max(MIN_DISPLAY_ACCURACY_M, Math.sqrt(horizontalKalman.variance)),
        timestamp: fused.timestamp,
        speed: fused.speed ?? speedFromStep,
        heading: fused.heading,
      };

      acceptedRef.current = fused;
      smoothedRef.current = smoothed;
      motionRef.current = estimateMotion(smoothed, speedFromStep);
      setError(null);
      // 表示更新は1秒周期のタイマーに任せる
    };

    // --- 歩行者デッドレコニング (PDR): 室内でGPSが使えない間の位置推定 ---
    const stepDetector = new StepDetector();

    const handleStep = (stepLengthM: number, cadenceHz: number) => {
      const heading = headingRef.current;
      const base = smoothedRef.current;
      const horizontalKalman = horizontalKalmanRef.current;
      if (heading === null || !base || !horizontalKalman) return;

      // 歩いた分だけカルマン状態(east/north)を進め、分散を歩幅に応じて増やす
      const projected = projectPosition(base, stepLengthM, heading);
      const moved = toLocalMeters(
        { lat: horizontalKalman.originLat, lng: horizontalKalman.originLng },
        projected,
      );
      horizontalKalman.east = moved.east;
      horizontalKalman.north = moved.north;
      horizontalKalman.variance = Math.min(
        horizontalKalman.variance + stepLengthM * PDR_STEP_VARIANCE_COEFF,
        Math.max(horizontalKalman.variance, PDR_MAX_ACCURACY_M ** 2),
      );

      const next: LivePosition = {
        ...projected,
        accuracy: Math.max(MIN_DISPLAY_ACCURACY_M, Math.sqrt(horizontalKalman.variance)),
        timestamp: Date.now(),
        speed: clamp(stepLengthM * cadenceHz, 0, MAX_REASONABLE_SPEED_MPS),
        heading,
      };

      smoothedRef.current = next;
      walkedSinceBlendRef.current += stepLengthM;
      lastStepAtRef.current = Date.now();
    };

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
      const step = stepDetector.process(acc.x, acc.y, acc.z, performance.now());
      if (step) handleStep(step.stepLengthM, step.cadenceHz);
    };

    window.addEventListener('devicemotion', handleMotion);

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
      window.removeEventListener('devicemotion', handleMotion);
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
      horizontalKalmanRef.current = null;
      altitudeKalmanRef.current = null;
    };
  }, [enabled, setCalibrationSnapshot]);

  useEffect(() => {
    if (!enabled) return;

    // 1秒に1回、最新の推定位置(GPS融合 + PDR)を発行する
    const timerId = window.setInterval(() => {
      const now = Date.now();
      const base = smoothedRef.current;
      if (!base) return;

      // 直近に歩行ステップで動かした場合はGPS速度による外挿と二重計上しない
      const steppedRecently = now - lastStepAtRef.current < 2000;
      const next = steppedRecently ? base : predictPosition(base, motionRef.current, now);

      displayedRef.current = next;
      setPosition(next);
      setIsIndoorMode(
        lastGoodGpsAtRef.current === 0 || now - lastGoodGpsAtRef.current > INDOOR_MODE_TIMEOUT_MS,
      );
    }, PUBLISH_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [enabled]);

  return { position, error, calibration, isIndoorMode, startStaticCalibration };
}
