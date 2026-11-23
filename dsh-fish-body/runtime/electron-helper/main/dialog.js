'use strict';
/**
 * 系统文件 / 目录选择框：宿主经 bridge 的 `POST /pick` 调到这里。
 *
 * 为什么放在 helper 里：`dialog.showOpenDialog` 只有 Electron 主进程能调，而 `/pick-file`
 * 是宿主进程在处理、设置页在浏览器里——中间缺一段「宿主 → helper」的调用面。
 * 本模块只做参数映射与三态归一，不碰窗口/托盘，也不自己起端口（bridge 的本地回调服务器共用）。
 *
 * 与 PowerShell 兜底（宿主 `pick-folder.ts`）逐项等价的地方：扩展名过滤、初始目录、取消语义。
 * 不等价的一处记在这里：Electron **既没有**关闭原生对话框的 API，**也没有**列举原生对话框的 API
 * （`BrowserWindow.getAllWindows()` 不含原生框）。所以本模块**不设任何超时**：
 * `inFlight` 的生命周期 = 那个真实存在的对话框的生命周期——用户在框里待多久都不算失败，
 * 只有 `showOpenDialog` 落地（选中 / 取消 / 关掉框 / 抛错）才在 `finally` 里释放互斥。
 * 宿主先断开连接时**不**释放 `inFlight`（框可能还在屏幕上，释放就会允许开第二个框），
 * 只由 `bridge.js` 的 `/pick` 保证不再往死掉的 socket 写应答。
 * @module dsh-fish-body/runtime/electron-helper/main/dialog
 */

/** 「所有文件」这一档：Electron 用 `['*']` 表示。 */
const ALL_FILES = { name: '所有文件', extensions: ['*'] };

/**
 * 扩展名 → Electron 的 `filters`。
 *
 * 客户端传来的是带点的写法（`['.ckpt','.pth']`，与 `/pick-file` 的既有契约一致），
 * 而 Electron 的 `filters[].extensions` **不接受前导点**（带了匹配不到任何文件），
 * 所以这里剥点；剥完为空就只给「所有文件」一档（与 PowerShell 兜底的空过滤分支同行为）。
 *
 * @param extensions - 允许的扩展名（可带点）。
 * @returns `filters` 数组，至少含「所有文件」。
 */
function filtersOf(extensions) {
  const bare = (Array.isArray(extensions) ? extensions : [])
    .map((ext) => String(ext == null ? '' : ext).trim())
    .map((ext) => ext.replace(/^\.+/, ''))
    .filter((ext) => ext !== '');
  if (bare.length === 0) return [ALL_FILES];
  return [{ name: '文件 (' + bare.map((ext) => '*.' + ext).join(';') + ')', extensions: bare }, ALL_FILES];
}

/**
 * 挑一个用来当 owner 的窗口：第一个还没被销毁的。
 *
 * @param BrowserWindow - Electron 的 BrowserWindow（可为 undefined：只做单测时没注入）。
 * @returns 窗口对象；没有就返回 `undefined`（无 owner 调用，不能因此失败）。
 */
function ownerWindowOf(BrowserWindow) {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return undefined;
  const windows = BrowserWindow.getAllWindows();
  if (!Array.isArray(windows)) return undefined;
  return windows.find((win) => win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed()));
}

/**
 * 造「弹一个系统选择框」的函数。
 *
 * 注入 Electron 的 `dialog` / `BrowserWindow`（与 `main/tray.js` 同一种写法）：
 * 本模块因此能被纯 Node 单测直接 `require`，不需要真的起 Electron。
 *
 * @param deps.dialog - Electron 的 `dialog`（用 `showOpenDialog`）。
 * @param deps.BrowserWindow - Electron 的 `BrowserWindow`（用 `getAllWindows` 找 owner）。
 * @returns `(req) => Promise<PickOutcome>`；同一个 helper 里同时只允许一个框（`busy`）。
 */
function createPickDialog({ dialog, BrowserWindow } = {}) {
  /**
   * 互斥：一个 helper 只有一个原生对话框实例，叠框会让两个请求的返回值互相串。
   *
   * 这个标记的生命周期 = **一个真实存在的原生对话框**（不是「一次请求」，也不是「一次连接」）：
   * 宿主先放弃（页面关掉 → 连接断了）时它仍然保持占用，因为框还在用户屏幕上。
   */
  let inFlight = false;

  /**
   * 弹一次选择框（**无超时**：人的思考时间不算失败）。
   *
   * @param req - `{ kind:'file'|'folder', title?, start?, extensions? }`；`timeoutMs` 已废弃，读到也忽略。
   * @returns `{ok:true,kind:'picked',path}` / `{ok:true,kind:'cancelled'}` /
   *          `{ok:false,reason:'busy'|'unsupported',message}`。
   */
  return async function pick(req) {
    if (inFlight) return { ok: false, reason: 'busy', message: '另一个选择框还开着，请先关掉已打开的选择框再点' };
    inFlight = true;
    try {
      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        return { ok: false, reason: 'unsupported', message: '当前 helper 没有 dialog.showOpenDialog' };
      }
      const request = req && typeof req === 'object' ? req : {};
      const folder = request.kind === 'folder';
      const options = folder
        ? { properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }
        : { properties: ['openFile', 'dontAddToRecent'], filters: filtersOf(request.extensions) };
      if (typeof request.title === 'string' && request.title !== '') options.title = request.title;
      // 初始目录：只有真给了才传；给了空串会让 Electron 从「上次目录」退回工作目录。
      if (typeof request.start === 'string' && request.start !== '') options.defaultPath = request.start;

      const owner = ownerWindowOf(BrowserWindow);
      const opening = owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
      // 防御性吞掉孤立 rejection：本模块现在已经没有「先返回、后面才落地」的路径，
      // 但将来任何人加一条提前 return，这次调用仍可能在之后 reject，别让它变成未处理的 rejection。
      Promise.resolve(opening).catch(() => {});

      // 直接 await 到对话框真正落地：没有计时器、没有 race、没有「按时间判失败」。
      const result = await opening;

      const picked = result && Array.isArray(result.filePaths) ? result.filePaths : [];
      if (!result || result.canceled === true || picked.length === 0) return { ok: true, kind: 'cancelled' };
      return { ok: true, kind: 'picked', path: String(picked[0]) };
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error);
      return { ok: false, reason: 'unsupported', message: message };
    } finally {
      // 唯一的释放点：对话框已经不在屏幕上（或它自己抛错）。
      inFlight = false;
    }
  };
}

module.exports = { createPickDialog, filtersOf };
