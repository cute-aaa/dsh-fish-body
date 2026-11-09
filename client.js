/**
 * dsh-fish-body 浏览器半区（DSH Web GUI 内）。
 * - 桌宠：shell.overlay，复用共享渲染内核 assets/core.js。
 * - 设置页：settings.section，草稿模型 + 顶部标签栏 + 底部固定操作条 + 改动标识。
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-body',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    if (!document.getElementById('dsh-fish-body-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'dsh-fish-body-style';
      styleEl.textContent = `
        .fb-root { display: flex; flex-direction: column; height: 100%; max-width: 660px; font: 13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color: var(--dsw-alias-label-primary); }
        .fb-tabs { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); position: sticky; top: 0; background: var(--dsw-alias-bg-base, transparent); z-index: 5; }
        .fb-tab { padding: 5px 10px; border-radius: 6px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }
        .fb-tab.active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
        .fb-dot { color: var(--dsw-alias-brand-primary); margin-left: 3px; }
        .fb-content { flex: 1; overflow-y: auto; padding: 8px 0 12px; }
        .fb-bottom { display: flex; gap: 8px; padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l1); position: sticky; bottom: 0; background: var(--dsw-alias-bg-base, transparent); z-index: 5; }
        .fb-section { font-size: 13px; font-weight: 600; margin: 12px 0 8px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 5px; }
        .fb-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
        .fb-row.dirty .fb-label > div:first-child::after { content: ' ●'; color: var(--dsw-alias-brand-primary); font-size: 9px; vertical-align: middle; }
        .fb-label { flex: 1; min-width: 0; }
        .fb-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
        .fb-input { width: 220px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 5px 8px; font: inherit; }
        .fb-select { width: 236px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 5px 8px; font: inherit; }
        .fb-textarea { width: 100%; min-height: 60px; box-sizing: border-box; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 6px 8px; font: inherit; resize: vertical; }
        .fb-checkbox { width: 18px; height: 18px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
        .fb-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; }
        .fb-btn.primary { background: var(--dsw-alias-brand-primary); color: #fff; border-color: transparent; }
        .fb-btn.danger { color: var(--dsw-alias-state-error-primary); }
        .fb-btn:disabled { opacity: .5; cursor: default; }
        .fb-err { color: var(--dsw-alias-state-error-primary); margin: 8px 0; }
        .fb-ok { color: var(--dsw-alias-state-success-primary); margin: 8px 0; }
      `;
      document.head.appendChild(styleEl);
    }

    // ---------- 桌宠（shell.overlay） ----------
    const CORE_SRC = '/fish-body-assets/core.js';
    const corePromise = {};

    function loadCore() {
      if (window.FishBodyCore) return Promise.resolve(window.FishBodyCore);
      if (!corePromise._p) {
        corePromise._p = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = CORE_SRC;
          s.onload = () => resolve(window.FishBodyCore);
          s.onerror = () => reject(new Error('core.js load failed'));
          document.head.appendChild(s);
        });
      }
      return corePromise._p;
    }

    function FishBodyPet() {
      const ref = useRef(null);
      const [gen, setGen] = useState(0);
      // null = 还不知道形态（避免 desktop 形态下先闪一下浏览器内的宠物）
      const [show, setShow] = useState(null);
      useEffect(() => {
        const onRestart = () => setGen((g) => g + 1);
        window.addEventListener('fish-body:restart', onRestart);
        return () => window.removeEventListener('fish-body:restart', onRestart);
      }, []);
      useEffect(() => {
        let alive = true;
        fetch('/api/fish-body/state')
          .then((r) => r.json())
          .then((s) => { if (alive) setShow(!(s && s.desktop !== undefined && s.form === 'desktop')); })
          .catch(() => { if (alive) setShow(true); });
        return () => { alive = false; };
      }, [gen]);
      useEffect(() => {
        if (show !== true || !ref.current) return undefined;
        let api = null;
        let alive = true;
        loadCore().then((core) => {
          if (!alive || !ref.current) return;
          api = core.mount(ref.current, { standalone: false });
        }).catch(() => {});
        return () => { alive = false; if (api) api.dispose(); };
      }, [gen, show]);
      return h('div', { ref, style: { width: 0, height: 0, position: 'fixed', right: 0, bottom: 0 }, 'aria-hidden': true });
    }

    // ---------- 设置页（settings.section） ----------
    const SETTINGS_API = '/api/fish-body/settings';
    const DESKTOP_KIND = {
      electron: 'Electron 无边框窗',
      'chromium-app': 'Chrome/Edge 应用窗口',
      browser: '浏览器标签页',
    };
    function kindLabel(kind) { return DESKTOP_KIND[kind] || kind || '未知'; }

    function clone(v) { return JSON.parse(JSON.stringify(v ?? null)); }
    function getByPath(obj, path) { return path.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj); }
    function setByPath(obj, path, val) {
      const o = clone(obj) || {};
      let cur = o;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = val;
      return o;
    }
    function diffOps(saved, draft, path = [], out = []) {
      const a = saved || {};
      const b = draft || {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        const av = a[k];
        const bv = b[k];
        if (av && typeof av === 'object' && !Array.isArray(av) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
          diffOps(av, bv, [...path, k], out);
        } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
          out.push({ op: 'set', path: [...path, k], value: bv });
        }
      }
      return out;
    }

    function Row(props) {
      return h('div', { className: 'fb-row' + (props.dirty ? ' dirty' : '') }, props.children);
    }
    function Label(props) {
      return h('div', { className: 'fb-label' },
        h('div', null, props.text),
        props.hint ? h('div', { className: 'fb-hint' }, props.hint) : null,
      );
    }
    function BoolField(props) {
      return h(Row, { dirty: props.dirty },
        h(Label, { text: props.text, hint: props.hint }),
        h('input', { type: 'checkbox', className: 'fb-checkbox', checked: !!props.value, onChange: (e) => props.onChange(e.target.checked) }),
      );
    }
    function TextField(props) {
      return h(Row, { dirty: props.dirty },
        h(Label, { text: props.text, hint: props.hint }),
        h('input', { type: 'text', className: 'fb-input', value: props.value ?? '', onChange: (e) => props.onChange(e.target.value) }),
      );
    }
    function NumberField(props) {
      return h(Row, { dirty: props.dirty },
        h(Label, { text: props.text, hint: props.hint }),
        h('input', {
          type: 'number', className: 'fb-input', value: props.value ?? 0, min: props.min, max: props.max, step: props.step ?? 1,
          onChange: (e) => props.onChange(Number(e.target.value)),
        }),
      );
    }
    function SelectField(props) {
      const options = Array.isArray(props.options) ? props.options : [];
      return h(Row, { dirty: props.dirty },
        h(Label, { text: props.text, hint: props.hint }),
        h('select', { className: 'fb-select', value: props.value ?? '', onChange: (e) => props.onChange(e.target.value) },
          options.map((o) => h('option', { key: o.value, value: o.value }, o.label ?? o.value)),
        ),
      );
    }
    function ListField(props) {
      const list = Array.isArray(props.value) ? props.value : [];
      return h('div', { className: 'fb-row' + (props.dirty ? ' dirty' : ''), style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
        h(Label, { text: props.text, hint: props.hint }),
        h('textarea', {
          className: 'fb-textarea', value: list.join('\n'), placeholder: props.placeholder,
          onChange: (e) => props.onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)),
        }),
      );
    }
    function Section(props) { return h('div', { className: 'fb-section' }, props.text); }

    // 设置项定义（数据驱动：便于标签栏 / 改动标识）
    const SECTIONS = [
      { id: 'basic', label: '基本', groups: [
        { fields: [
          { key: ['enabled'], type: 'bool', label: '启用桌宠', hint: '关闭后不渲染宠物' },
          { key: ['form'], type: 'select', label: '集成形态', hint: '浏览器内 / 桌面独立窗口',
            options: [{ value: 'browser', label: '浏览器内（browser）' }, { value: 'desktop', label: '桌面独立窗口（desktop）' }] },
          { key: ['size'], type: 'number', label: '尺寸（px）', hint: '40 ~ 800', min: 40, max: 800 },
          { key: ['scale'], type: 'number', label: '缩放', hint: '0.2 ~ 4', min: 0.2, max: 4, step: 0.1 },
        ] },
      ] },
      { id: 'anim', label: '动画', groups: [
        { title: '动画', fields: [
          { key: ['modelType'], type: 'select', label: '动画类型', options: [
            { value: 'webm', label: 'webm 透明视频' },
            { value: 'layered', label: 'layered 分层皮肤（PNG）' },
            { value: 'live2d', label: 'live2d 模型' },
          ] },
          { key: ['layeredSkin'], type: 'skin', label: '分层皮肤', hint: 'surfcore 皮肤目录（含 manifest.json 的 layered 皮肤）' },
          { key: ['webmSet'], type: 'wbmset', label: 'webm 角色包', hint: '资源目录里 characters/<id>/ 的动画集；空 = 内置默认' },
          { key: ['webmIdle'], type: 'text', label: '待机动画', hint: '如「待机呼吸休闲」' },
          { key: ['webmClick'], type: 'text', label: '点击动画', hint: '如「点击回应-开心跃动」' },
          { key: ['webmIdleSound'], type: 'text', label: '动画音效', hint: '待机循环音效（可留空）' },
          { key: ['clickSound'], type: 'text', label: '点击音效', hint: '默认音效（动画未绑定时使用）' },
          { key: ['live2dModel'], type: 'text', label: 'live2d 模型', hint: '模型 id 或 model3.json URL' },
        ] },
        { title: '余额动作（按档位自动选）', fields: [
          { key: ['webmBalanceFull'], type: 'text', label: '余额-满', hint: '余额 ≥ 基准（CNY20/USD5）' },
          { key: ['webmBalanceNormal'], type: 'text', label: '余额-常', hint: '余额 > 0 且未满' },
          { key: ['webmBalanceEmpty'], type: 'text', label: '余额-空', hint: '余额为 0 或查不到' },
        ] },
      ] },
      { id: 'persona', label: '人格', groups: [
        { fields: [
          { key: ['personaSource'], type: 'select', label: '人格来源', hint: '原生使用该来源的人设卡', options: [
            { value: 'fish-soul', label: 'dsh-fish-soul（大肥鱼）' },
            { value: 'dsh-soul', label: 'dsh-soul' },
            { value: 'dsh-rofm', label: 'dsh-rofm' },
            { value: 'dsh-suzu-memory', label: 'dsh-suzu-memory' },
          ] },
        ] },
      ] },
      { id: 'voice', label: '语音', groups: [
        { fields: [
          { key: ['voiceProvider'], type: 'select', label: '语音 provider', options: [
            { value: 'none', label: '关闭' },
            { value: 'gpt-sovits', label: 'GPT-SoVITS' },
            { value: 'tts', label: '通用 TTS（OpenAI 兼容）' },
            { value: 'cloud', label: '云端语音（自定义 HTTP）' },
          ] },
          { key: ['voice', 'gptSovitsBaseUrl'], type: 'text', label: 'GPT-SoVITS 地址' },
          { key: ['voice', 'ttsBaseUrl'], type: 'text', label: 'TTS 地址', hint: '如 http://host/v1' },
          { key: ['voice', 'ttsKey'], type: 'text', label: 'TTS key' },
          { key: ['voice', 'cloudBaseUrl'], type: 'text', label: '云端语音地址' },
          { key: ['voice', 'cloudKey'], type: 'text', label: '云端语音 key' },
          { key: ['voice', 'referenceAudioUrl'], type: 'text', label: '参考音频 URL', hint: 'GPT-SoVITS 音色克隆参考' },
        ] },
      ] },
      { id: 'res', label: '资源', groups: [
        { fields: [
          { key: ['resourceDirs'], type: 'list', label: '资源目录', hint: '每行一个绝对路径，递归扫描子文件夹里的 webm / 音效 / live2d' },
        ] },
      ] },
      { id: 'interact', label: '互动', groups: [
        { fields: [
          { key: ['taskStatus'], type: 'bool', label: '实时显示 dsh 任务状态' },
          { key: ['syncActivity'], type: 'bool', label: '同步真实行为', hint: '从 dsh-fish-soul 读她最近真实做过的事' },
          { key: ['screenRecognition'], type: 'bool', label: '识别屏幕内容并互动', hint: '需视觉模型' },
          { key: ['screenIntervalMs'], type: 'number', label: '屏幕识别间隔（ms）', hint: '3000 ~ 300000', min: 3000, max: 300000 },
          { key: ['followDsh'], type: 'bool', label: '随 dsh 启动 / 停止' },
        ] },
      ] },
      { id: 'avoid', label: '避让', groups: [
        { fields: [
          { key: ['avoidance', 'fullscreen'], type: 'bool', label: '全屏时避让' },
          { key: ['avoidance', 'dshIdle'], type: 'bool', label: 'dsh 不对话时避让' },
          { key: ['avoidance', 'followDsh'], type: 'bool', label: '随 dsh 启停避让' },
          { key: ['avoidance', 'appList'], type: 'list', label: '应用名单避让', hint: '每行一个应用名/进程名（前台命中即避让）' },
        ] },
      ] },
    ];

    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    function FishBodySettings() {
      const [saved, setSaved] = useState(null);
      const [draft, setDraft] = useState(null);
      const [loading, setLoading] = useState(true);
      const [err, setErr] = useState(null);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(false);
      const [tab, setTab] = useState('basic');
      const [assets, setAssets] = useState(null);
      const [desk, setDesk] = useState(null);
      const [deskBusy, setDeskBusy] = useState(false);

      useEffect(() => {
        fetch(SETTINGS_API).then((r) => r.json()).then((d) => {
          setSaved(clone(d.value ?? {}));
          setDraft(clone(d.value ?? {}));
          setLoading(false);
        }).catch((e) => { setErr(String(e)); setLoading(false); });
        loadAssets();
        refreshDesk();
      }, []);

      function loadAssets() {
        fetch('/api/fish-body/assets').then((r) => r.json()).then(setAssets).catch(() => {});
      }

      function refreshDesk() {
        return fetch('/api/fish-body/desktop').then((r) => r.json()).then((d) => setDesk(d)).catch(() => {});
      }

      function desktopAction(action) {
        setDeskBusy(true);
        setNotice(null);
        fetch('/api/fish-body/desktop', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
        })
          .then((r) => r.json())
          .then((d) => {
            setDesk(d.status ?? null);
            if (action === 'open') {
              setNotice(d.ok
                ? (d.reused ? '桌面窗口已经在运行' : `已打开（${kindLabel(d.kind)}）`)
                : `打开失败：${d.error || d.kind || '未知'}`);
            } else {
              setNotice('桌面窗口已关闭');
            }
          })
          .catch((e) => setNotice(`操作失败：${e}`))
          .finally(() => setDeskBusy(false));
      }

      if (loading) return h('div', { className: 'fb-root' }, '加载中…');
      if (err) return h('div', { className: 'fb-root' },
        h('div', { className: 'fb-err' }, '设置读取失败：' + err),
        h('button', { className: 'fb-btn', onClick: () => window.location.reload() }, '重试'),
      );

      const current = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0];
      const dirtyOf = (key) => !same(getByPath(saved, key), getByPath(draft, key));
      const sectionDirty = (s) => s.groups.some((g) => g.fields.some((f) => dirtyOf(f.key)));

      function set(path, val) { setDraft((d) => setByPath(d, path, val)); setNotice(null); }

      function save() {
        setErr(null);
        const ops = diffOps(saved, draft);
        if (ops.length === 0) { setNotice('没有改动'); return Promise.resolve(); }
        setBusy(true);
        return fetch(SETTINGS_API, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }),
        }).then((r) => r.json()).then((d) => {
          const next = clone(d.value ?? draft);
          setSaved(next); setDraft(next); setNotice('已保存');
        }).catch((e) => setNotice(`保存失败：${e}`)).finally(() => setBusy(false));
      }

      function apply() {
        save().then(() => { window.dispatchEvent(new CustomEvent('fish-body:restart')); setNotice('已应用（桌宠已刷新）'); });
      }

      function resetAll() {
        setDraft(clone(saved));
        setNotice('已还原为上次保存');
      }

      function restart() {
        window.dispatchEvent(new CustomEvent('fish-body:restart'));
        setNotice('桌宠已重启');
      }

      function rescan() {
        setNotice('扫描中…');
        fetch('/api/fish-body/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then((r) => r.json())
          .then((d) => {
            setAssets(d.manifest ?? null);
            const skinCount = d.manifest?.skins?.length ?? 0;
            setNotice(`已扫描：${d.manifest?.webm?.length ?? 0} 个动画 / ${d.manifest?.sounds?.length ?? 0} 个音效 / ${skinCount} 个分层皮肤`);
          })
          .catch((e) => setNotice(`扫描失败：${e}`));
      }

      function renderDesktop() {
        const st = desk || {};
        const engine = st.engine || {};
        const running = Boolean(st.running);
        const engineLabel = engine.electron ? 'Electron' : (engine.chromium ? 'Chrome/Edge 应用窗口' : '系统默认浏览器');
        const isDesktopForm = getByPath(draft, ['form']) === 'desktop';
        return h('div', { className: 'fb-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
          h(Label, {
            text: '桌面独立窗口',
            hint: running ? `运行中：${kindLabel(st.kind)}${st.pid ? `（pid ${st.pid}）` : ''}` : `未运行（可用引擎：${engineLabel}）`,
          }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('button', { className: 'fb-btn', disabled: deskBusy, onClick: () => desktopAction('open') }, running ? '重新打开' : '打开桌面窗口'),
            running ? h('button', { className: 'fb-btn danger', disabled: deskBusy, onClick: () => desktopAction('close') }, '关闭') : null,
            h('button', { className: 'fb-btn', onClick: () => refreshDesk() }, '刷新状态'),
          ),
          isDesktopForm && !running
            ? h('div', { className: 'fb-hint' }, '当前形态是 desktop 但窗口没开：点「打开桌面窗口」，或保存配置后自动打开。')
            : null,
          !engine.electron && isDesktopForm
            ? h('div', { className: 'fb-hint' }, '没装 Electron：会用 Chrome/Edge 的「应用模式」开独立窗口（无地址栏、随窗口退出）。')
            : null,
        );
      }

      function renderField(f) {
        const value = getByPath(draft, f.key);
        const dirty = dirtyOf(f.key);
        const onChange = (v) => set(f.key, v);
        if (f.type === 'bool') return h(BoolField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange });
        if (f.type === 'number') return h(NumberField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange, min: f.min, max: f.max, step: f.step });
        if (f.type === 'select') return h(SelectField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange, options: f.options });
        if (f.type === 'list') return h(ListField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange });
        if (f.type === 'skin') {
          const skins = (assets && assets.skins) || [];
          const options = skins.map((s) => ({ value: s.id, label: `${s.name || s.id}（${s.layerCount ?? '?'} 层）` }));
          if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: `${value}（未在资源目录中找到）` });
          if (options.length === 0) options.push({ value: '', label: '（还没扫描到皮肤）' });
          return h(SelectField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange, options });
        }
        if (f.type === 'wbmset') {
          const sets = (assets && assets.webmSets) || [];
          const options = [{ value: '', label: '默认（内置动画集）' }]
            .concat(sets.map((s) => ({ value: s.id, label: `${s.id}（${s.count} 个动作）` })));
          if (value && !options.some((o) => o.value === value)) options.push({ value, label: `${value}（未在资源目录中找到）` });
          return h(SelectField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange, options });
        }
        return h(TextField, { key: f.key.join('.'), text: f.label, hint: f.hint, value, dirty, onChange });
      }

      return h('div', { className: 'fb-root' },
        h('div', { className: 'fb-tabs' },
          SECTIONS.map((s) => h('button', {
            key: s.id,
            className: 'fb-tab' + (s.id === tab ? ' active' : ''),
            onClick: () => setTab(s.id),
          }, s.label, sectionDirty(s) ? h('span', { className: 'fb-dot' }, '●') : null)),
        ),
        h('div', { className: 'fb-content' },
          notice ? h('div', { className: 'fb-ok' }, notice) : null,
          current.groups.map((g, gi) => h('div', { key: gi },
            g.title ? h(Section, { text: g.title }) : null,
            g.fields.map((f) => renderField(f)),
            current.id === 'basic' && gi === current.groups.length - 1 ? renderDesktop() : null,
            current.id === 'anim' && gi === 0
              ? h('div', { className: 'fb-hint', style: { marginTop: 6 } },
                'layered 皮肤直接读 manifest.json 的图层顺序、rigOptions 与命中区；点波奇碗（pot 区）会播 pot-hit 音效。')
              : null,
            current.id === 'res' && g === current.groups[0] ? h(Row, null,
              h(Label, { text: '重新扫描资源', hint: '扫描资源目录（含子文件夹），刷新动画 / 音效 / 分层皮肤清单' }),
              h('button', { className: 'fb-btn', onClick: rescan }, '扫描'),
            ) : null,
          )),
          h('div', { style: { marginTop: 16 } },
            h('button', { className: 'fb-btn danger', onClick: resetAll }, '重置（还原上次保存）'),
          ),
        ),
        h('div', { className: 'fb-bottom' },
          h('button', { className: 'fb-btn primary', disabled: busy, onClick: save }, '保存'),
          h('button', { className: 'fb-btn', disabled: busy, onClick: apply }, '应用'),
          h('button', { className: 'fb-btn', onClick: restart }, '重启'),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-fish-body', order: 1100, label: '大肥鱼桌宠',
        }, FishBodyPet));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-fish-body', order: 200, label: () => '大肥鱼桌宠',
        }, FishBodySettings));
      },
    };
  },
});
