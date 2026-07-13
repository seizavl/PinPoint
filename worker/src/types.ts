// client/src/types/index.ts と同内容。Cloudflare Worker 側でも同じ型を使用する。

export type LocationFixMode = 'gps' | 'network' | 'hybrid';

export type LocationSignal = 'gps' | 'wifi' | 'bluetooth' | 'mobile_network';

export interface LocationDiagnostics {
  fixMode: LocationFixMode;
  sampleCount: number;
  spreadMeters: number;
  consideredSignals: LocationSignal[];
  unavailableSignals: LocationSignal[];
  networkType: string | null;
}

export interface GPSPayload {
  userId: string;
  type: 'gps';
  lat: number;
  lng: number;
  altitude: number | null;
  altitudeAccuracy?: number | null;
  accuracy: number;
  timestamp: number;
  diagnostics?: LocationDiagnostics;
}

export interface WorldCoordPayload {
  userId: string;
  type: 'world';
  lat: number;
  lng: number;
  altitude: number | null;
  altitudeAccuracy?: number | null;
  accuracy: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  timestamp: number;
  diagnostics?: LocationDiagnostics;
}

export type LocationPayload = GPSPayload | WorldCoordPayload;

export interface BroadcastPayload {
  users: Record<string, LocationPayload>;
}

// クライアント⇔Worker 間の WebSocket メッセージ形式
export interface ClientToServerMessage {
  event: 'send_location';
  payload: LocationPayload;
}

export type ServerToClientMessage =
  | { event: 'locations_update'; payload: BroadcastPayload }
  | { event: 'user_count'; payload: { count: number } };
