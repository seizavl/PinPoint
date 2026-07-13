import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocationPayload } from '../types';

interface MiniMapProps {
  selfPosition: { lat: number; lng: number } | null;
  locations: Record<string, LocationPayload>;
  myUserId: string;
}

const MINI_ZOOM = 16;
const MODAL_SINGLE_ZOOM = 17;

// 自位置(青)・他ユーザー(赤)の点マーカー。固定文字列のみを使うためXSSの懸念はない。
const selfDivIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:9999px;background:#3b82f6;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const otherDivIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:9999px;background:#ef4444;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

// 自位置の変化に追従して地図の中心を移動する(表示専用ミニマップ用)
function Follower({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.setView([position.lat, position.lng], map.getZoom());
  }, [position, map]);
  return null;
}

// モーダル表示時、自分+他ユーザー全員が収まるよう一度だけ画角を合わせる
function FitAll({
  selfPosition,
  others,
}: {
  selfPosition: { lat: number; lng: number } | null;
  others: LocationPayload[];
}) {
  const map = useMap();
  useEffect(() => {
    const points: L.LatLngExpression[] = [];
    if (selfPosition) points.push([selfPosition.lat, selfPosition.lng]);
    for (const o of others) points.push([o.lat, o.lng]);

    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], MODAL_SINGLE_ZOOM);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

export function MiniMap({ selfPosition, locations, myUserId }: MiniMapProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const others = Object.values(locations).filter((u) => u.userId !== myUserId);

  // ESCで閉じる
  useEffect(() => {
    if (!modalOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen]);

  return (
    <>
      {/* 常時表示の小さなミニマップ。ⓘボタン(bottom-3 right-3)と被らないよう bottom-16 に配置 */}
      <div
        className="absolute bottom-16 right-3 h-36 w-36 overflow-hidden rounded-xl border border-white/20 shadow-lg"
        style={{ pointerEvents: 'auto' }}
      >
        {selfPosition ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="マップを拡大表示"
            className="block h-full w-full"
          >
            <MapContainer
              center={[selfPosition.lat, selfPosition.lng]}
              zoom={MINI_ZOOM}
              zoomControl={false}
              attributionControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Follower position={selfPosition} />
              <Marker position={[selfPosition.lat, selfPosition.lng]} icon={selfDivIcon} />
              {others.map((u) => (
                <Marker key={u.userId} position={[u.lat, u.lng]} icon={otherDivIcon} />
              ))}
            </MapContainer>
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800/90 text-center text-[11px] text-slate-300">
            位置取得中...
          </div>
        )}
      </div>

      {/* 拡大モーダル: 開いたときだけ MapContainer をマウントする(サイズ確定後に描画するため) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="absolute inset-3 flex flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-slate-800 px-4 py-2">
              <span className="text-sm font-bold text-white">マップ</span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="閉じる"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-white hover:bg-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="flex-1">
              <MapContainer
                center={selfPosition ? [selfPosition.lat, selfPosition.lng] : [35.6762, 139.6503]}
                zoom={MODAL_SINGLE_ZOOM}
                zoomControl
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitAll selfPosition={selfPosition} others={others} />
                {selfPosition && (
                  <Marker position={[selfPosition.lat, selfPosition.lng]} icon={selfDivIcon}>
                    <Popup>
                      自分 ({myUserId.slice(0, 6)})
                    </Popup>
                  </Marker>
                )}
                {others.map((u) => (
                  <Marker key={u.userId} position={[u.lat, u.lng]} icon={otherDivIcon}>
                    <Popup>
                      {u.userId.slice(0, 6)} · ±{u.accuracy.toFixed(0)}m
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
