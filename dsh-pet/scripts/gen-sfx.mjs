/**
 * 生成包内默认音效（assets/sound/drag.wav / throw.wav / bump-soft.wav / pet-bump.wav）。
 *
 * 为什么用合成而不是找素材：默认音只是「有动静」的占位，体积、响度与声学前提必须可控——
 * 全部 44.1kHz / 16bit / 单声道、峰值不超过 40% 满幅、攻击段压在 t=0（配合常热 WebAudio 首声不缺头）、
 * 时长 60–160ms。素材要换随时可以覆盖（用户目录与皮肤目录优先级都比包内高）。
 *
 * 用法：`node scripts/gen-sfx.mjs`（幂等，重复执行得到同一份字节）。
 * 产物入库；改了合成公式要重新跑一次并一并提交。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const PEAK = 0.38;

/** 确定性伪随机：合成噪声不希望每次跑出不同字节。 */
function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/** 指数衰减包络：`k` 越大收得越快。 */
const decay = (t, k) => Math.exp(-t * k);

/** 线性起音，避免第一个样本从 0 跳到峰值造成爆音（但起音极短，仍在 2ms 内到峰值）。 */
const attack = (t, ms = 1.5) => Math.min(1, t / (ms / 1000));

/** 拼一份单声道采样。 */
function render(durationMs, fn) {
  const total = Math.round((SAMPLE_RATE * durationMs) / 1000);
  const data = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    data[i] = fn(t, i);
  }
  // 归一化到 PEAK，保证「听得见但不炸」，且换公式后响度不会失控。
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < total; i += 1) data[i] *= gain;
  return data;
}

/** 抖落音：短促的低通噪声，像布料擦过桌面。 */
function drag() {
  const noise = makeNoise(0x51ed270b);
  let low = 0;
  return render(110, (t) => {
    low = low * 0.82 + noise() * 0.18;
    return low * attack(t) * decay(t, 26);
  });
}

/** 甩出音：450→900Hz 的上滑短音。 */
function throwSfx() {
  return render(140, (t) => {
    const f = 450 + 450 * Math.min(1, t / 0.09);
    return Math.sin(2 * Math.PI * f * t) * attack(t) * decay(t, 22);
  });
}

/** 碰撞音：150Hz 低频撞击 + 一点点高频瞬态。 */
function bumpSoft() {
  const noise = makeNoise(0x1b873593);
  return render(120, (t) => {
    const body = Math.sin(2 * Math.PI * 150 * t) * decay(t, 30);
    const click = noise() * decay(t, 260) * 0.35;
    return (body + click) * attack(t);
  });
}

/** 宠物互撞：两声上行「啵」，听感比撞墙轻。 */
function petBump() {
  return render(160, (t) => {
    const first = t < 0.055 ? Math.sin(2 * Math.PI * 520 * t) * decay(t, 40) : 0;
    const t2 = t - 0.055;
    const second = t2 >= 0 ? Math.sin(2 * Math.PI * 700 * t2) * decay(t2, 34) * 0.8 : 0;
    return (first + second) * attack(t);
  });
}

/** Float32 采样 → 16bit PCM 单声道 WAV。 */
function toWav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt 块长度
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 单声道
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // 字节率
  buffer.writeUInt16LE(2, 32); // 块对齐
  buffer.writeUInt16LE(16, 34); // 位深
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'assets', 'sound');
mkdirSync(outDir, { recursive: true });

const files = [
  ['drag.wav', drag()],
  ['throw.wav', throwSfx()],
  ['bump-soft.wav', bumpSoft()],
  ['pet-bump.wav', petBump()],
];

for (const [name, samples] of files) {
  const bytes = toWav(samples);
  writeFileSync(join(outDir, name), bytes);
  const ms = ((samples.length / SAMPLE_RATE) * 1000).toFixed(0);
  console.log(name + ': ' + ms + 'ms, ' + bytes.length + ' bytes');
}
