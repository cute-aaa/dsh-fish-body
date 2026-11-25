// 隔离 DSH Web 的点击验收：设置页 → 自定义 persona 路径 → 自定义 memory 目录。
// 令牌与临时路径由环境变量提供；脚本不读写真实数据根。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const token = process.env.LIVE_TOKEN;
const port = process.env.LIVE_PORT;
const persona = process.env.LIVE_CUSTOM_PERSONA;
const memory = process.env.LIVE_CUSTOM_MEMORY;
if (!token || !port || !persona || !memory) throw new Error('缺少 LIVE_* 环境变量');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(`http://127.0.0.1:${port}/?token=${token}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForTimeout(4000);
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '账号菜单', exact: true }).click();
await page.getByText('设置', { exact: false }).first().click();
await page.getByText('桌宠配置', { exact: false }).first().click();

// 选择 custom 来源并保存路径；不需要打开系统文件框。
await page.getByRole('button', { name: '来源', exact: true }).click();
await page.getByRole('option', { name: '自定义路径', exact: false }).click();
const personaInput = page.locator('input[placeholder*="persona"]').first();
await personaInput.fill(persona);
await page.getByRole('button', { name: '保存并扫描', exact: true }).click();
await page.waitForTimeout(2000);
console.log('AFTER_PERSONA', (await page.locator('body').innerText()).slice(-1800));
await page.getByRole('button', { name: '角色', exact: true }).click();
await page.getByRole('option', { name: /鱼生/ }).click();
await page.getByRole('button', { name: '应用到此宠物', exact: true }).click();
await page.waitForTimeout(1000);

// 系统页的自定义 memory 目录。
await page.getByRole('tab', { name: '系统', exact: false }).click();
await page.getByRole('button', { name: '自定义目录', exact: true }).click();
const memoryInput = page.locator('input[placeholder*="绝对路径"]').first();
await memoryInput.fill(memory);
await page.getByRole('button', { name: '保存并重连', exact: true }).click();
await page.getByText('custom-memory', { exact: false }).first().waitFor({ timeout: 15_000 });

assert.ok((await page.locator('body').innerText()).includes('自定义记忆'), '应显示自定义记忆目录状态');
if (process.env.LIVE_SHOT) await page.screenshot({ path: process.env.LIVE_SHOT, fullPage: true });
await browser.close();
console.log('LIVE_SETTINGS_ACCEPTANCE_OK');
