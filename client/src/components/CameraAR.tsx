import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useLivePosition } from '../hooks/useLivePosition';
import { useLiveOrientation } from '../hooks/useLiveOrientation';
import { bearingDeg, distanceMeters, relativeBearing } from '../utils/geo';

// スマホ背面カメラの想定水平画角(度)。値を調整すれば左右のズレを補正できる。
const CAMERA_FOV_DEG = 65;

// 救助対象（人間）の想定実寸 (m)
const TARGET_HEIGHT_M = 1.7;
const TARGET_WIDTH_M = 0.5;

// 距離が近すぎて箱が巨大化するのを防ぐ下限
const MIN_DISTANCE_M = 1.5;

type AccuracyLevel = 'waiting' | 'excellent' | 'good' | 'fair' | 'poor';

function getAccuracyInfo(accuracy: number | null): {
  level: AccuracyLevel;
  label: string;
  score: number;
  hint: string;
} {
  if (accuracy === null) {
    return { level: 'waiting', label: '位置取得中', score: 0, hint: '数秒待ってください' };
  }
  if (accuracy <= 5) {
    return { level: 'excellent', label: '最高', score: 100, hint: 'AR表示に十分な精度です' };
  }
  if (accuracy <= 12) {
    return { level: 'good', label: '高精度', score: 84, hint: 'かなり安定しています' };
  }
  if (accuracy <= 25) {
    return { level: 'fair', label: '実用', score: 58, hint: '静止キャリブレーション推奨' };
  }
  return { level: 'poor', label: '低精度', score: 25, hint: '空が見える場所で静止してください' };
}

function accuracyBarClass(level: AccuracyLevel): string {
  switch (level) {
    case 'excellent':
      return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]';
    case 'good':
      return 'bg-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.7)]';
    case 'fair':
      return 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.7)]';
    case 'poor':
      return 'bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.7)]';
    case 'waiting':
      return 'bg-slate-500';
  }
}

function accuracyTextClass(level: AccuracyLevel): string {
  switch (level) {
    case 'excellent':
      return 'text-emerald-300';
    case 'good':
      return 'text-lime-300';
    case 'fair':
      return 'text-yellow-300';
    case 'poor':
      return 'text-orange-300';
    case 'waiting':
      return 'text-slate-300';
  }
}

/**
 * 実寸 sizeM の物体が distanceM 先にあるときの画面上ピクセルサイズを計算。
 * screenDim = 対応する画面方向のピクセル数 (水平なら画面幅, 垂直なら画面高)
 * fovDeg = 対応する方向の画角
 */
function projectSize(sizeM: number, distanceM: number, screenDim: number, fovDeg: number): number {
  const d = Math.max(distanceM, MIN_DISTANCE_M);
  const angularRad = 2 * Math.atan(sizeM / (2 * d));
  const fovRad = (fovDeg * Math.PI) / 180;
  return (angularRad / fovRad) * screenDim;
}

function getUserId(): string {
  const stored = localStorage.getItem('disaster_ar_user_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('disaster_ar_user_id', id);
  return id;
}

export function CameraAR() {
  const myUserId = getUserId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 360,
    h: typeof window !== 'undefined' ? window.innerHeight : 640,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // 水平FOVとビューポートのアスペクト比から垂直FOVを算出
  const aspect = viewport.w / viewport.h;
  const fovHRad = (CAMERA_FOV_DEG * Math.PI) / 180;
  const fovVDeg = (2 * Math.atan(Math.tan(fovHRad / 2) / aspect) * 180) / Math.PI;

  const { locations, connected } = useSocket();
  const { position, error: posError, calibration, startStaticCalibration } = useLivePosition(started);
  const { orientation, requestPermission } = useLiveOrientation(started);

  const allCount = Object.keys(locations).length;
  const accuracyInfo = getAccuracyInfo(position?.accuracy ?? null);
  const isCalibrating = calibration.status === 'collecting';

  // カメラ起動
  useEffect(() => {
    if (!started) return;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        setCamError((e as Error).message);
      }
    })();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [started]);

  async function handleStart() {
    const granted = await requestPermission();
    if (!granted) {
      setCamError('センサーの使用が拒否されました');
      return;
    }
    setStarted(true);
  }

  // カメラの仰俯角（正=上向き、負=下向き）
  // 端末を縦持ちで構えた状態 beta ≈ 90° を「水平前向き」として扱う
  const cameraPitchDeg = orientation.beta !== null ? orientation.beta - 90 : 0;

  // 他ユーザーの投影を計算
  const targets = Object.values(locations)
    .filter((u) => u.userId !== myUserId)
    .map((u) => {
      if (!position || orientation.heading === null) return null;
      const dist = distanceMeters(position.lat, position.lng, u.lat, u.lng);
      const brg = bearingDeg(position.lat, position.lng, u.lat, u.lng);
      const rel = relativeBearing(brg, orientation.heading);

      // 高度差（不明なら0）から仰俯角を計算。水平ならゼロ。
      const dAlt = (u.altitude ?? 0) - (position.altitude ?? 0);
      const targetPitchDeg = (Math.atan2(dAlt, Math.max(dist, 1)) * 180) / Math.PI;

      // カメラの仰俯角に対する相対的な縦方向角度。正=画面上側、負=下側。
      const verticalDeg = targetPitchDeg - cameraPitchDeg;
      return { user: u, dist, brg, rel, verticalDeg };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // 画面内に入るターゲットだけ描画（縦も判定）
  const onScreen = targets.filter(
    (t) => Math.abs(t.rel) <= CAMERA_FOV_DEG / 2 && Math.abs(t.verticalDeg) <= fovVDeg / 2,
  );
  const offScreen = targets.filter(
    (t) => Math.abs(t.rel) > CAMERA_FOV_DEG / 2 || Math.abs(t.verticalDeg) > fovVDeg / 2,
  );

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      {/* カメラ映像 */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />

      {!started && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-slate-900/90 p-6">
          <h1 className="text-2xl font-bold text-red-400">AR wallhack モード</h1>
          <p className="text-slate-300 text-sm text-center max-w-xs">
            カメラ・位置情報・方位センサーを使用します。<br />
            許可ダイアログが表示されます。
          </p>
          <button
            onClick={handleStart}
            className="px-8 py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-lg"
          >
            ▶ 開始
          </button>
          {camError && <p className="text-red-400 text-sm">{camError}</p>}
        </div>
      )}

      {/* AR オーバーレイ */}
      {started && (
        <>
          {/* 画面内のターゲットを四角で描画 */}
          {onScreen.map(({ user, dist, brg, rel, verticalDeg }) => {
            const leftPct = ((rel + CAMERA_FOV_DEG / 2) / CAMERA_FOV_DEG) * 100;
            // 縦位置：カメラが上を向く(pitch↑)と水平面が画面下に移動するので top% が増える
            const topPct = 50 - (verticalDeg / fovVDeg) * 100;
            // 実寸ベースの投影：人間サイズが距離に応じて画面で占めるピクセル数
            const boxHeight = projectSize(TARGET_HEIGHT_M, dist, viewport.h, fovVDeg);
            const boxWidth = projectSize(TARGET_WIDTH_M, dist, viewport.w, CAMERA_FOV_DEG);
            return (
              <div
                key={user.userId}
                className="absolute pointer-events-none"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: `translate(-50%, -50%)`,
                  width: `${boxWidth}px`,
                  height: `${boxHeight}px`,
                }}
              >
                {/* 四角フレーム（wallhack風） */}
                <div className="absolute inset-0 border-2 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
                <div className="absolute inset-0 bg-red-500/10" />
                {/* ラベル */}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap bg-red-600/90 px-2 py-1 rounded text-xs font-mono">
                  <div>ID: {user.userId.slice(0, 6)}</div>
                  <div>{dist.toFixed(1)}m · {brg.toFixed(0)}°</div>
                </div>
              </div>
            );
          })}

          {/* 画面外の矢印（端に表示） */}
          {offScreen.map(({ user, dist, rel }) => {
            const isLeft = rel < 0;
            return (
              <div
                key={user.userId}
                className="absolute top-1/2 -translate-y-1/2 bg-orange-600/90 px-2 py-1 rounded text-xs font-mono pointer-events-none"
                style={{ [isLeft ? 'left' : 'right']: '8px' } as React.CSSProperties}
              >
                {isLeft ? '◀' : '▶'} {user.userId.slice(0, 6)} · {dist.toFixed(0)}m
              </div>
            );
          })}

          {/* HUD 情報 */}
          <div className="absolute top-2 left-2 right-2 flex justify-between text-xs font-mono bg-black/50 px-2 py-1 rounded">
            <div>
              {position ? (
                <>
                  {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                  <span className={position.accuracy < 30 ? 'text-green-400' : 'text-yellow-400'}> ±{position.accuracy.toFixed(0)}m</span>
                </>
              ) : (
                <span className="text-yellow-400">位置取得中...</span>
              )}
            </div>
            <div>
              {orientation.heading !== null ? (
                <>方位 {orientation.heading.toFixed(0)}° / 仰俯 {cameraPitchDeg.toFixed(0)}°</>
              ) : (
                <span className="text-yellow-400">方位取得中...</span>
              )}
            </div>
          </div>

          <div className="absolute top-12 left-2 right-2 rounded-2xl border border-white/10 bg-black/65 p-3 text-xs shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Location precision</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className={`text-lg font-bold ${accuracyTextClass(accuracyInfo.level)}`}>
                    {accuracyInfo.label}
                  </span>
                  <span className="font-mono text-slate-200">
                    {position ? `±${position.accuracy.toFixed(1)}m` : '--'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={startStaticCalibration}
                disabled={!position || isCalibrating}
                className="rounded-xl bg-cyan-500 px-3 py-2 text-[11px] font-bold text-slate-950 transition hover:bg-cyan-300 disabled:bg-slate-700 disabled:text-slate-400"
              >
                {isCalibrating ? '計測中...' : '静止補正'}
              </button>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${accuracyBarClass(accuracyInfo.level)}`}
                style={{ width: `${accuracyInfo.score}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-300">
              <span>{accuracyInfo.hint}</span>
              {position?.speed !== null && position?.speed !== undefined && (
                <span className="font-mono">{position.speed.toFixed(1)}m/s</span>
              )}
            </div>

            {calibration.status !== 'idle' && (
              <div className="mt-3 rounded-xl bg-white/10 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={
                      calibration.status === 'success'
                        ? 'font-bold text-emerald-300'
                        : calibration.status === 'failed'
                          ? 'font-bold text-red-300'
                          : 'font-bold text-cyan-300'
                    }
                  >
                    静止キャリブレーション
                  </span>
                  <span className="font-mono text-slate-300">
                    {Math.round(calibration.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      calibration.status === 'failed' ? 'bg-red-400' : 'bg-cyan-300'
                    }`}
                    style={{ width: `${calibration.progress * 100}%` }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-300">
                  <span>{calibration.message}</span>
                  <span className="font-mono">
                    n={calibration.sampleCount}
                    {calibration.accuracy !== null ? ` / ±${calibration.accuracy.toFixed(1)}m` : ''}
                    {calibration.spreadMeters !== null ? ` / spread ${calibration.spreadMeters.toFixed(1)}m` : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-1 text-xs font-mono bg-black/50 px-2 py-1 rounded">
            <div className="flex justify-between">
              <div>
                <span className={connected ? 'text-green-400' : 'text-red-400'}>
                  {connected ? '●' : '○'} WS
                </span>
                {' · '}
                サーバーから: {allCount}件
                {' · '}
                自分以外: {targets.length}人
                {' · '}
                画面内: {onScreen.length}
              </div>
              <div>FOV {CAMERA_FOV_DEG}°H / {fovVDeg.toFixed(0)}°V</div>
            </div>
            {allCount === 0 && (
              <div className="text-yellow-300">
                ⚠ サーバーにデータなし。別の端末/タブで位置送信ボタンを押してください
              </div>
            )}
            {allCount > 0 && targets.length === 0 && (
              <div className="text-yellow-300">
                ⚠ 登録されているのは自分自身のみ（myId={myUserId.slice(0, 6)}）
              </div>
            )}
            {targets.length > 0 && !position && (
              <div className="text-yellow-300">⚠ 位置取得待ち</div>
            )}
            {targets.length > 0 && orientation.heading === null && (
              <div className="text-yellow-300">⚠ 方位センサー取得待ち（スマホを8の字に振ってください）</div>
            )}
          </div>

          {/* 中央の十字 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-6 h-[2px] bg-white/70" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-6 bg-white/70" />
          </div>

          {(camError || posError) && (
            <div className="absolute top-10 left-2 right-2 bg-red-900/80 px-2 py-1 rounded text-xs">
              {camError || posError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
