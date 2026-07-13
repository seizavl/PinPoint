export type GeoSampleSource = 'gps' | 'network';

export interface GeoSample {
  lat: number;
  lng: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  accuracy: number;
  timestamp: number;
  speed: number | null;
  heading: number | null;
  source?: GeoSampleSource;
}

// 局所平面(接平面)上のメートル座標。カルマンフィルタなど平面近似の状態表現に使う。
export interface LocalMeters {
  east: number;
  north: number;
}

export interface GeoFusionResult {
  sample: GeoSample;
  sampleCount: number;
  spreadMeters: number;
  bestAccuracy: number;
  sources: GeoSampleSource[];
}

const EARTH_RADIUS_M = 6371000;
const MAX_REASONABLE_SPEED_MPS = 15;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeSpeed(speed: number | null): number | null {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) return null;
  return clamp(speed, 0, MAX_REASONABLE_SPEED_MPS);
}

export function sanitizeHeading(heading: number | null): number | null {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return null;
  return (heading % 360 + 360) % 360;
}

export function sanitizeAltitudeAccuracy(altitudeAccuracy: number | null | undefined): number | null {
  if (typeof altitudeAccuracy !== 'number' || !Number.isFinite(altitudeAccuracy) || altitudeAccuracy < 0) {
    return null;
  }
  return altitudeAccuracy;
}

export function extractGeoSample(
  position: GeolocationPosition,
  source: GeoSampleSource = 'gps',
): GeoSample {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    altitude: position.coords.altitude,
    altitudeAccuracy: sanitizeAltitudeAccuracy(position.coords.altitudeAccuracy),
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
    speed: sanitizeSpeed(position.coords.speed),
    heading: sanitizeHeading(position.coords.heading),
    source,
  };
}

// 緯度経度を、原点(origin)を基準とした局所平面のメートル座標(東西/南北)に変換する。
// distanceMeters と同じ equirectangular 近似(原点の緯度でスケール)を用いる。
export function toLocalMeters(
  origin: Pick<GeoSample, 'lat' | 'lng'>,
  point: Pick<GeoSample, 'lat' | 'lng'>,
): LocalMeters {
  const lat1 = toRad(origin.lat);
  const dLat = toRad(point.lat - origin.lat);
  const dLng = toRad(point.lng - origin.lng);
  return {
    east: dLng * Math.cos(lat1) * EARTH_RADIUS_M,
    north: dLat * EARTH_RADIUS_M,
  };
}

// toLocalMeters の逆変換。局所平面座標を緯度経度に戻す。
export function fromLocalMeters(
  origin: Pick<GeoSample, 'lat' | 'lng'>,
  local: LocalMeters,
): { lat: number; lng: number } {
  const lat1 = toRad(origin.lat);
  const dLat = local.north / EARTH_RADIUS_M;
  const dLng = local.east / (EARTH_RADIUS_M * Math.cos(lat1));
  return {
    lat: origin.lat + toDeg(dLat),
    lng: origin.lng + toDeg(dLng),
  };
}

export function distanceMeters(a: Pick<GeoSample, 'lat' | 'lng'>, b: Pick<GeoSample, 'lat' | 'lng'>): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const x = dLng * Math.cos((lat1 + lat2) / 2);
  const y = dLat;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

export function bearingDeg(a: Pick<GeoSample, 'lat' | 'lng'>, b: Pick<GeoSample, 'lat' | 'lng'>): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function projectPosition(base: GeoSample, distanceM: number, bearing: number): GeoSample {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const heading = toRad(bearing);
  const lat1 = toRad(base.lat);
  const lng1 = toRad(base.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(heading),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    ...base,
    lat: toDeg(lat2),
    lng: toDeg(lng2),
  };
}

function sampleScore(sample: GeoSample, newestTimestamp: number): number {
  const ageSec = Math.max(0, (newestTimestamp - sample.timestamp) / 1000);
  return clamp(sample.accuracy, 3, 120) + ageSec * 2;
}

function averageHeading(
  samples: GeoSample[],
  newestTimestamp: number,
  fallbackHeading: number | null,
): number | null {
  let x = 0;
  let y = 0;

  for (const sample of samples) {
    if (sample.heading === null) continue;
    const ageSec = Math.max(0, (newestTimestamp - sample.timestamp) / 1000);
    const baseWeight = 1 / Math.max(sample.accuracy, 3);
    const recencyWeight = 1 / (1 + ageSec * 0.6);
    const motionWeight = sample.speed !== null ? Math.max(sample.speed, 0.8) : 1;
    const weight = baseWeight * recencyWeight * motionWeight;
    const rad = toRad(sample.heading);
    x += Math.cos(rad) * weight;
    y += Math.sin(rad) * weight;
  }

  if (x === 0 && y === 0) return fallbackHeading;
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function appendGeoSample(
  samples: GeoSample[],
  candidate: GeoSample,
  maxAgeMs = 12000,
  maxCount = 8,
): GeoSample[] {
  const cutoff = candidate.timestamp - maxAgeMs;
  return [...samples.filter((sample) => sample.timestamp >= cutoff), candidate]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxCount);
}

export function isLikelyOutlier(
  candidate: GeoSample,
  reference: GeoSample,
  maxReasonableSpeedMps = MAX_REASONABLE_SPEED_MPS,
): boolean {
  const dtSec = Math.max((candidate.timestamp - reference.timestamp) / 1000, 0.001);
  const jumpMeters = distanceMeters(reference, candidate);
  const speedMps = jumpMeters / dtSec;
  const allowedJump = Math.max(15, Math.max(candidate.accuracy, reference.accuracy) * 0.6 + 8);

  return (
    candidate.accuracy >= reference.accuracy &&
    jumpMeters > allowedJump &&
    speedMps > maxReasonableSpeedMps
  );
}

export function fuseGeoSamples(samples: GeoSample[]): GeoFusionResult {
  if (samples.length === 0) {
    throw new Error('fuseGeoSamples requires at least one sample');
  }

  if (samples.length === 1) {
    const sources = [samples[0].source ?? 'gps'];
    return {
      sample: samples[0],
      sampleCount: 1,
      spreadMeters: 0,
      bestAccuracy: samples[0].accuracy,
      sources,
    };
  }

  const newestTimestamp = Math.max(...samples.map((sample) => sample.timestamp));
  const anchor = samples.reduce((best, sample) =>
    sampleScore(sample, newestTimestamp) < sampleScore(best, newestTimestamp) ? sample : best,
  );

  const clustered = samples.filter((sample) => {
    const threshold = Math.max(6, Math.max(anchor.accuracy, sample.accuracy) * 0.9 + 5);
    return distanceMeters(anchor, sample) <= threshold;
  });

  const cluster = clustered.length >= 2 ? clustered : [anchor];
  const sources = Array.from(
    new Set(cluster.map((sample) => sample.source ?? 'gps')),
  );

  let weightSum = 0;
  let latSum = 0;
  let lngSum = 0;
  let altitudeSum = 0;
  let altitudeWeightSum = 0;
  let bestAltitudeAccuracy: number | null = null;
  let speedSum = 0;
  let speedWeightSum = 0;
  const bestAccuracy = Math.min(...cluster.map((sample) => sample.accuracy));

  for (const sample of cluster) {
    const ageSec = Math.max(0, (newestTimestamp - sample.timestamp) / 1000);
    const accuracyWeight = 1 / clamp(sample.accuracy, 3, 100) ** 2;
    const recencyWeight = 1 / (1 + ageSec * 0.75);
    const weight = accuracyWeight * recencyWeight;
    weightSum += weight;
    latSum += sample.lat * weight;
    lngSum += sample.lng * weight;

    if (sample.altitude !== null) {
      // 高度はaltitudeAccuracyによる重み付け(不明なら30mとみなす)で融合する
      const altitudeWeight = (1 / clamp(sample.altitudeAccuracy ?? 30, 3, 100) ** 2) * recencyWeight;
      altitudeSum += sample.altitude * altitudeWeight;
      altitudeWeightSum += altitudeWeight;
      if (sample.altitudeAccuracy !== null) {
        bestAltitudeAccuracy =
          bestAltitudeAccuracy === null
            ? sample.altitudeAccuracy
            : Math.min(bestAltitudeAccuracy, sample.altitudeAccuracy);
      }
    }

    if (sample.speed !== null) {
      speedSum += sample.speed * weight;
      speedWeightSum += weight;
    }
  }

  const centroid: GeoSample = {
    lat: latSum / weightSum,
    lng: lngSum / weightSum,
    altitude: altitudeWeightSum > 0 ? altitudeSum / altitudeWeightSum : anchor.altitude,
    altitudeAccuracy: altitudeWeightSum > 0 ? bestAltitudeAccuracy : anchor.altitudeAccuracy,
    accuracy: bestAccuracy,
    timestamp: newestTimestamp,
    speed: speedWeightSum > 0 ? speedSum / speedWeightSum : anchor.speed,
    heading: null,
    source: sources.length > 1 ? undefined : sources[0],
  };

  let spreadWeightSum = 0;
  let spreadDistanceSum = 0;
  for (const sample of cluster) {
    const weight = 1 / clamp(sample.accuracy, 3, 100);
    spreadWeightSum += weight;
    spreadDistanceSum += distanceMeters(sample, centroid) * weight;
  }

  const spreadMeters = spreadWeightSum > 0 ? spreadDistanceSum / spreadWeightSum : 0;
  const oldest = cluster.reduce((oldestSample, sample) =>
    sample.timestamp < oldestSample.timestamp ? sample : oldestSample,
  );
  const newest = cluster.reduce((newestSample, sample) =>
    sample.timestamp > newestSample.timestamp ? sample : newestSample,
  );
  const fallbackHeading =
    distanceMeters(oldest, newest) >= 0.8 ? bearingDeg(oldest, newest) : anchor.heading;
  const clusterHeading = averageHeading(cluster, newestTimestamp, fallbackHeading);

  return {
    sample: {
      ...centroid,
      accuracy: clamp(
        Math.max(
          bestAccuracy * (cluster.length >= 3 ? 0.62 : 0.82),
          spreadMeters * 1.4,
          cluster.length >= 4 ? 3 : 4,
        ),
        3,
        bestAccuracy,
      ),
      heading: clusterHeading,
    },
    sampleCount: cluster.length,
    spreadMeters,
    bestAccuracy,
    sources,
  };
}
