/**
 * 抓 README 用的真实运行截图：打开 3099 的页面，等桌宠出来 → 截一张 → 投喂一句话再截 → 让它睡下再截。
 *
 * 只做「打开 / 点击 / 截图」，不改任何配置、不写数据根（气泡与睡觉都是运行时状态，进程重启即回到默认）。
 * 用完要 /wake，别把宠物留在睡着状态。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const token = process.argv[2];
const base = "http://127.0.0.1:3099";
const outDir = "G:/Projnew/ai/dsh-fish-body/docs/images";
const auth = { Authorization: `Bearer ${token}` };

if (!token) throw new Error("用法: node shot.mjs <token>");
mkdirSync(outDir, { recursive: true });

const api = async (path, init = {}) => {
  const res = await fetch(`${base}/dsh-pet-7340/${path}`, {
    ...init,
    headers: {
      ...auth,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.text() };
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});

page.on("console", (m) => {
  if (m.type() === "error") console.log("[page error]", m.text().slice(0, 200));
});

console.log("open", `${base}/?token=***`);
await page.goto(`${base}/?token=${token}`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
// 桌宠是 overlay：等它真的画出东西（webm 首帧 + 皮肤），而不是等 load 事件
await page.waitForTimeout(12_000);

const state = await api("state");
console.log("state", state.status, state.body.slice(0, 120));

await page.screenshot({ path: `${outDir}/running-web-1.png` });
console.log("shot 1 (idle)");

const said = await api("broadcast?pet=main&surface=web", {
  method: "POST",
  body: JSON.stringify({
    text: "在这儿呢，今天想让我陪你写点什么？",
    ms: 12_000,
  }),
});
console.log("broadcast", said.status, said.body.slice(0, 160));
await page.waitForTimeout(2_500);
await page.screenshot({ path: `${outDir}/running-web-2.png` });
console.log("shot 2 (bubble)");

const slept = await api("sleep?pet=main", { method: "POST" });
console.log("sleep", slept.status, slept.body.slice(0, 160));
await page.waitForTimeout(4_000);
await page.screenshot({ path: `${outDir}/running-web-3.png` });
console.log("shot 3 (sleeping)");

const woke = await api("wake?pet=main", { method: "POST" });
console.log("wake", woke.status, woke.body.slice(0, 160));

await browser.close();
console.log("done");
