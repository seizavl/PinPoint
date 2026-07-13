// 加速度センサー(DeviceMotion)から歩行ステップを検出する。
// 室内でGPSが劣化したときの歩行者デッドレコニング(PDR)の入力に使う。

export interface StepEvent {
  stepLengthM: number;
  cadenceHz: number;
}

const MIN_STEP_INTERVAL_MS = 280;
const MAX_STEP_INTERVAL_MS = 2000;
// 重力除去後の加速度がこの値を超えたら1歩とみなす閾値 (m/s^2)
const STEP_THRESHOLD_MPS2 = 1.1;
// 再アーム(次の歩の検出許可)のヒステリシス閾値
const REARM_THRESHOLD_MPS2 = 0.3;
// 重力成分を推定する低速EMA係数
const GRAVITY_EMA_ALPHA = 0.02;
// ノイズ平滑用の高速EMA係数
const SMOOTH_EMA_ALPHA = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class StepDetector {
  private gravityEma: number | null = null;
  private smoothEma = 0;
  private lastStepAtMs = 0;
  private armed = true;

  process(x: number, y: number, z: number, nowMs: number): StepEvent | null {
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    this.gravityEma =
      this.gravityEma === null
        ? magnitude
        : this.gravityEma + (magnitude - this.gravityEma) * GRAVITY_EMA_ALPHA;
    const dynamic = magnitude - this.gravityEma;
    this.smoothEma += (dynamic - this.smoothEma) * SMOOTH_EMA_ALPHA;

    let step: StepEvent | null = null;
    if (
      this.armed &&
      this.smoothEma > STEP_THRESHOLD_MPS2 &&
      nowMs - this.lastStepAtMs >= MIN_STEP_INTERVAL_MS
    ) {
      const intervalMs = nowMs - this.lastStepAtMs;
      const cadenceHz = intervalMs <= MAX_STEP_INTERVAL_MS ? 1000 / intervalMs : 1.6;
      // 歩幅はケイデンスに比例して伸びる近似 (速歩ほど歩幅が広い)
      const stepLengthM = clamp(0.35 + 0.2 * cadenceHz, 0.5, 0.85);
      this.lastStepAtMs = nowMs;
      this.armed = false;
      step = { stepLengthM, cadenceHz };
    }

    if (this.smoothEma < REARM_THRESHOLD_MPS2) {
      this.armed = true;
    }
    return step;
  }
}
