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

export type SendStatus = 'idle' | 'sending' | 'success' | 'error' | 'permission_denied';
