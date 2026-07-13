import { useState } from 'react';
import { useGPS } from '../hooks/useGPS';
import { useOrientation } from '../hooks/useOrientation';
import { useSocket } from '../hooks/useSocket';
import { LocationDiagnostics, LocationSignal } from '../types';
import { StatusBadge } from './StatusBadge';

const signalLabels: Record<LocationSignal, string> = {
  gps: 'GPS',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  mobile_network: 'モバイル網',
};

function fixModeLabel(mode: LocationDiagnostics['fixMode']): string {
  switch (mode) {
    case 'hybrid':
      return 'ハイブリッド';
    case 'network':
      return 'ネットワーク補完';
    case 'gps':
      return 'GPS優先';
  }
}

function DiagnosticsText({ diagnostics }: { diagnostics: LocationDiagnostics | null }) {
  if (!diagnostics) return null;

  const considered = diagnostics.consideredSignals.map((signal) => signalLabels[signal]).join(' / ');
  const unavailable =
    diagnostics.unavailableSignals.length > 0
      ? ` / 未対応: ${diagnostics.unavailableSignals.map((signal) => signalLabels[signal]).join(' / ')}`
      : '';

  return (
    <span className="text-xs text-slate-400 text-center">
      方式: {fixModeLabel(diagnostics.fixMode)} / n={diagnostics.sampleCount} / {considered}
      {unavailable}
    </span>
  );
}

export function ClientScreen() {
  const { connected, sendLocation } = useSocket();
  const gps = useGPS();
  const orientation = useOrientation();
  // 開発者向け診断情報(方式/n=/考慮シグナル等)はデフォルト非表示にし、「詳細」で開閉する
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const userId = localStorage.getItem('pinpoint_user_id') ?? '（未生成）';
  const maskedId = userId.slice(0, 8) + '...';

  async function handleGPS() {
    gps.setStatus('sending');
    try {
      const payload = await gps.getGPS();
      sendLocation(payload);
      gps.setStatus('success');
    } catch (err) {
      const e = err as GeolocationPositionError;
      gps.setStatus(e.code === 1 ? 'permission_denied' : 'error');
    }
  }

  async function handleWorldCoord() {
    orientation.setStatus('sending');
    try {
      const granted = await orientation.requestPermission();
      if (!granted) {
        orientation.setStatus('permission_denied');
        return;
      }
      orientation.startListening();
      const payload = await orientation.getWorldCoord();
      sendLocation(payload);
      orientation.setStatus('success');
    } catch (err) {
      const e = err as GeolocationPositionError;
      orientation.setStatus(e.code === 1 ? 'permission_denied' : 'error');
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-blue-400 mb-1">PinPoint</h1>
        <p className="text-slate-400 text-sm">位置情報送信パネル</p>
      </div>

      {/* 接続状態 */}
      <div className="flex items-center gap-2">
        <span
          className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500 animate-pulse'}`}
        />
        <span className="text-sm text-slate-300">{connected ? 'サーバー接続中' : '切断中 (再接続試行中...)'}</span>
      </div>

      {/* 統合位置送信 */}
      <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-blue-300">統合位置送信</h2>
          <p className="text-slate-400 text-xs mt-1">GPSとWi-Fi/モバイル網の測位候補を統合して送信します</p>
        </div>
        <button
          onClick={handleGPS}
          disabled={!connected || gps.status === 'sending'}
          className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold text-lg transition-colors"
        >
          📍 統合位置を送信
        </button>
        <div className="flex flex-col items-center gap-1">
          <StatusBadge status={gps.status} />
          {gps.accuracy !== null && (
            <span className={`text-xs ${gps.accuracy < 20 ? 'text-green-400' : gps.accuracy < 50 ? 'text-yellow-400' : 'text-orange-400'}`}>
              精度: ±{gps.accuracy.toFixed(0)}m
            </span>
          )}
          {showDiagnostics && <DiagnosticsText diagnostics={gps.diagnostics} />}
        </div>
      </div>

      {/* 世界座標送信 */}
      <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-red-300">世界座標送信</h2>
          <p className="text-slate-400 text-xs mt-1">統合位置 + 向き（alpha/beta/gamma）を送信します</p>
          <p className="text-yellow-400 text-xs mt-1">※ iOSは初回にセンサー許可ダイアログが表示されます</p>
        </div>
        <button
          onClick={handleWorldCoord}
          disabled={!connected || orientation.status === 'sending'}
          className="w-full py-4 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold text-lg transition-colors"
        >
          🧭 世界座標を送信
        </button>
        <div className="flex flex-col items-center gap-1">
          <StatusBadge status={orientation.status} />
          {orientation.accuracy !== null && (
            <span className={`text-xs ${orientation.accuracy < 20 ? 'text-green-400' : orientation.accuracy < 50 ? 'text-yellow-400' : 'text-orange-400'}`}>
              精度: ±{orientation.accuracy.toFixed(0)}m
            </span>
          )}
          {showDiagnostics && <DiagnosticsText diagnostics={orientation.diagnostics} />}
        </div>
      </div>

      {/* 詳細診断情報の開閉 */}
      <button
        type="button"
        onClick={() => setShowDiagnostics((v) => !v)}
        className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
      >
        {showDiagnostics ? '詳細を隠す' : '詳細を表示'}
      </button>

      {/* ARカメラへのリンク */}
      <a
        href="/camera"
        className="w-full max-w-sm py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-center text-slate-200 font-semibold transition-colors"
      >
        📷 ARカメラを開く
      </a>

      {/* userID表示 */}
      <div className="text-center">
        <p className="text-xs text-slate-600">ユーザーID: {maskedId}</p>
      </div>
    </div>
  );
}
