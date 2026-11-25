// 本地验收探针：用真实 DSH 页面确认插件已挂载并输出可交互文本。
// 只接收临时实例的端口与令牌；不读取用户配置，不点击未确认的元素。
import { chromium } from 'playwright';

const token = process.env.LIVE_TOKEN;
const port = process.env.LIVE_PORT;
if (!token || !port) throw new Error('需要 LIVE_TOKEN 与 LIVE_PORT');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/?token=${token}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForTimeout(5000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('BUTTONS', JSON.stringify(await page.locator('button').allInnerTexts()));
const continueButton = page.getByRole('button', { name: '继续', exact: true });
if ((await continueButton.count()) > 0) {
  await continueButton.first().click();
  await page.waitForTimeout(500);
}
if (process.env.LIVE_CLICK) {
  await page.getByText(process.env.LIVE_CLICK, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}
if (process.env.LIVE_CLICK2) {
  await page.getByText(process.env.LIVE_CLICK2, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}
if (process.env.LIVE_ARIA) {
  await page.getByRole('button', { name: process.env.LIVE_ARIA, exact: true }).first().click();
  await page.waitForTimeout(2500);
}
if (process.env.LIVE_CLICK3) {
  await page.getByText(process.env.LIVE_CLICK3, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}
if (process.env.LIVE_CLICK4) {
  await page.getByText(process.env.LIVE_CLICK4, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}
console.log('BUTTONS2', JSON.stringify(await page.locator('button').allInnerTexts()));
console.log(
  'BUTTONMETA',
  JSON.stringify(
    await page.locator('button').evaluateAll((buttons) =>
      buttons.map((button) => ({
        text: button.textContent,
        aria: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        cls: button.className,
      })),
    ),
  ),
);
console.log('TITLE', await page.title());
console.log('BODY', (await page.locator('body').innerText()).slice(0, 6000));
if (process.env.LIVE_SHOT) await page.screenshot({ path: process.env.LIVE_SHOT, fullPage: true });
await browser.close();
