/**
 * 设置页表单控件：把「标签 + 控件 + 说明」的重复结构收成函数。
 *
 * 只造 DOM 并把编辑回调交回调用方，不持有状态、不发请求——状态归各面板片段。
 * 所有文本都走 textContent，页面里不拼 HTML 字符串，避免配置值被当成标记执行。
 * @module dsh-fish-body/src/standalone/settings-page/script/widgets
 */

/** 生成控件层片段。 */
export function widgetsScript(): string {
  return `
function fieldRow(id, label, control, hint) {
  return make('div', { class: 'field' }, [
    make('label', { for: id, text: label }),
    control,
    hint ? make('p', { class: 'fieldHint', text: hint }) : null,
  ]);
}

function textField(id, label, value, onChange, opts) {
  const input = make('input', { type: 'text', id: id, value: value });
  if (opts && opts.maxLength) input.maxLength = opts.maxLength;
  if (opts && opts.disabled) input.disabled = true;
  if (opts && opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener('input', () => {
    onChange(input.value);
    markDirty(true);
  });
  return fieldRow(id, label, input, opts && opts.hint);
}

function numberField(id, label, value, onChange, opts) {
  const input = make('input', { type: 'number', id: id, value: String(value) });
  if (opts) {
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    if (opts.step !== undefined) input.step = String(opts.step);
    if (opts.disabled) input.disabled = true;
    if (opts.readOnly) {
      input.readOnly = true;
      input.tabIndex = -1;
    }
  }
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (input.value === '' || !Number.isFinite(parsed)) return;
    onChange(parsed);
    markDirty(true);
  });
  return fieldRow(id, label, input, opts && opts.hint);
}

/**
 * 滑块 + 数字框：范围类数值（画框大小、音量档位）用它。
 *
 * 两个控件写同一个值：拖滑块给即时手感，数字框给精确输入；两侧互相同步后再回调，
 * 所以外部只需要一个 onChange。clampNumber 在文件末尾，函数声明提升，这里可以先用。
 */
function rangeField(id, label, value, onChange, opts) {
  const min = opts && opts.min !== undefined ? opts.min : 0;
  const max = opts && opts.max !== undefined ? opts.max : 100;
  const step = opts && opts.step !== undefined ? opts.step : 1;
  const range = make('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), class: 'range' });
  const box = make('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(value), class: 'rangeValue' });
  const apply = (next, from) => {
    const parsed = clampNumber(next, min, max, min);
    if (from !== 'range') range.value = String(parsed);
    if (from !== 'box') box.value = String(parsed);
    onChange(parsed);
    markDirty(true);
  };
  range.addEventListener('input', () => apply(range.value, 'range'));
  box.addEventListener('input', () => { if (box.value === '') return; apply(box.value, 'box'); });
  if (opts && opts.disabled) {
    range.disabled = true;
    box.disabled = true;
  }
  return fieldRow(id, label, make('div', { class: 'rangeRow' }, [range, box]), opts && opts.hint);
}

function selectField(id, label, value, options, onChange, hint) {
  const select = createSelect(options, value, (picked) => {
    onChange(picked);
    markDirty(true);
  });
  select.root.id = id;
  const labelId = id + '-label';
  select.root.firstElementChild.setAttribute('aria-labelledby', labelId);
  return make('div', { class: 'field' }, [
    make('span', { class: 'fieldLabel', id: labelId, text: label }),
    select.root,
    hint ? make('p', { class: 'fieldHint', text: hint }) : null,
  ]);
}

function toggleRow(id, title, hint, checked, onChange) {
  const box = make('input', { type: 'checkbox', id: id, checked: checked });
  box.addEventListener('change', () => {
    onChange(box.checked);
    markDirty(true);
  });
  return make('label', { class: 'rowCheck' }, [
    box,
    make('span', { class: 'rowCheckText' }, [
      make('span', { class: 'rowCheckTitle', text: title }),
      hint ? make('span', { class: 'rowCheckHint', text: hint }) : null,
    ]),
  ]);
}

function card(title, hint, kids) {
  return make('div', { class: 'card' }, [
    make('div', { class: 'cardHead' }, [make('h2', { class: 'cardTitle', text: title })]),
    hint ? make('p', { class: 'cardHint', text: hint }) : null,
  ].concat(kids || []));
}

function button(text, onClick, opts) {
  const node = make('button', { type: 'button', class: opts && opts.danger ? 'btn ghost' : 'btn', text: text });
  node.addEventListener('click', onClick);
  return node;
}

function tabButton(text, selected, onClick) {
  const node = make('button', { type: 'button', class: 'tab', text: text });
  node.setAttribute('role', 'tab');
  node.setAttribute('aria-selected', selected ? 'true' : 'false');
  node.addEventListener('click', onClick);
  return node;
}

function cornerLabel(corner) {
  if (corner === 'top-left') return '左上角';
  if (corner === 'top-right') return '右上角';
  if (corner === 'bottom-left') return '左下角';
  return '右下角';
}

function displayLabel(display) {
  if (display === 'web') return '仅浏览器';
  if (display === 'desktop') return '仅桌面';
  if (display === 'both') return '两者都显示';
  return '都不显示';
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
`;
}
