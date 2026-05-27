import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from '../hooks/useSocket';
import { LocationDiagnostics, LocationPayload, LocationSignal, WorldCoordPayload } from '../types';

// Leaflet デフォルトアイコン修正
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ja-JP');
}

const signalLabels: Record<LocationSignal, string> = {
  gps: 'GPS',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  mobile_network: 'モバイル網',
};

function fixModeLabel(diagnostics?: LocationDiagnostics): string {
  switch (diagnostics?.fixMode) {
    case 'hybrid':
      return 'ハイブリッド';
    case 'network':
      return 'ネットワーク補完';
    case 'gps':
      return 'GPS優先';
    default:
      return '不明';
  }
}

function signalList(signals: LocationSignal[] | undefined): string {
  if (!signals || signals.length === 0) return 'N/A';
  return signals.map((signal) => signalLabels[signal]).join(' / ');
}

function DirectionArrow({ alpha }: { alpha: number | null }) {
  if (alpha === null) return null;
  return (
    <div
      className="inline-block text-2xl"
      style={{ transform: `rotate(${alpha}deg)`, display: 'inline-block' }}
      title={`方位角: ${alpha.toFixed(1)}°`}
    >
      ↑
    </div>
  );
}

function AutoCenter({ locations }: { locations: Record<string, LocationPayload> }) {
  const map = useMap();
  useEffect(() => {
    const entries = Object.values(locations);
    if (entries.length === 0) return;
    if (entries.length === 1) {
      map.setView([entries[0].lat, entries[0].lng], map.getZoom());
      return;
    }
    const latlngs: L.LatLngExpression[] = entries.map((e) => [e.lat, e.lng]);
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
  }, [locations, map]);
  return null;
}

export function AdminMap() {
  const { connected, userCount, locations } = useSocket();

  const entries = Object.entries(locations);
  const defaultCenter: L.LatLngExpression = [35.6762, 139.6503]; // 東京

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800 shadow z-10">
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500 animate-pulse'}`}
          />
          <span className="text-white font-bold text-sm">災害AR 管理者マップ</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-300">
          <span>被災者数: <strong className="text-white">{entries.length}</strong></span>
          <span>接続: <strong className="text-white">{userCount}</strong></span>
        </div>
      </header>

      {/* 凡例 */}
      <div className="flex gap-4 px-4 py-1 bg-slate-800 border-t border-slate-700 text-xs text-slate-300">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> 統合位置送信
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> 世界座標送信（向き付き）
        </span>
      </div>

      {/* マップ */}
      <div className="flex-1">
        <MapContainer
          center={defaultCenter}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <AutoCenter locations={locations} />
          {entries.map(([userId, data]) => (
            <Marker
              key={userId}
              position={[data.lat, data.lng]}
              icon={data.type === 'gps' ? blueIcon : redIcon}
            >
              <Popup>
                <div className="text-sm min-w-[180px]">
                  <div className="font-bold mb-1">{data.type === 'gps' ? '📍 統合位置' : '🧭 世界座標'}</div>
                  <div className="text-gray-600 text-xs break-all mb-2">ID: {userId.slice(0, 16)}...</div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr><td className="text-gray-500 pr-2">緯度</td><td>{data.lat.toFixed(6)}</td></tr>
                      <tr><td className="text-gray-500 pr-2">経度</td><td>{data.lng.toFixed(6)}</td></tr>
                      <tr><td className="text-gray-500 pr-2">高度</td><td>{data.altitude !== null ? `${data.altitude.toFixed(1)}m` : 'N/A'}</td></tr>
                      <tr><td className="text-gray-500 pr-2">精度</td><td>±{data.accuracy.toFixed(0)}m</td></tr>
                      <tr><td className="text-gray-500 pr-2">方式</td><td>{fixModeLabel(data.diagnostics)}</td></tr>
                      <tr><td className="text-gray-500 pr-2">考慮</td><td>{signalList(data.diagnostics?.consideredSignals)}</td></tr>
                      {data.diagnostics?.unavailableSignals.length ? (
                        <tr>
                          <td className="text-gray-500 pr-2">未対応</td>
                          <td>{signalList(data.diagnostics.unavailableSignals)}</td>
                        </tr>
                      ) : null}
                      {data.diagnostics && (
                        <tr>
                          <td className="text-gray-500 pr-2">サンプル</td>
                          <td>
                            {data.diagnostics.sampleCount}件 / spread {data.diagnostics.spreadMeters.toFixed(1)}m
                          </td>
                        </tr>
                      )}
                      {data.diagnostics?.networkType && (
                        <tr><td className="text-gray-500 pr-2">回線</td><td>{data.diagnostics.networkType}</td></tr>
                      )}
                      {data.type === 'world' && (
                        <>
                          <tr>
                            <td className="text-gray-500 pr-2">方位角</td>
                            <td>
                              {(data as WorldCoordPayload).alpha !== null
                                ? `${(data as WorldCoordPayload).alpha!.toFixed(1)}° `
                                : 'N/A '}
                              <DirectionArrow alpha={(data as WorldCoordPayload).alpha} />
                            </td>
                          </tr>
                          <tr><td className="text-gray-500 pr-2">beta</td><td>{(data as WorldCoordPayload).beta?.toFixed(1) ?? 'N/A'}°</td></tr>
                          <tr><td className="text-gray-500 pr-2">gamma</td><td>{(data as WorldCoordPayload).gamma?.toFixed(1) ?? 'N/A'}°</td></tr>
                        </>
                      )}
                      <tr><td className="text-gray-500 pr-2">時刻</td><td>{formatTime(data.timestamp)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
