/**
 * Offline harness for dsh-no-enter-send.
 *
 * The plugin is a browser bundle: it calls window.__ModuleLoader__.load and
 * touches nothing but the DOM. This harness supplies a small fake DOM, runs
 * client.js in a fresh vm context, and asserts the keyboard contract that the
 * plugin exists for — Enter never sends, Enter still breaks the line, and the
 * gray hint is rendered.
 *
 * Run: node test/harness.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SOURCE = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(name + (detail === undefined ? '' : ' — ' + detail));
}

function assertEqual(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ------------------------------------------------------------------ fake DOM */

const allElements = [];

class FakeElement {
  constructor(tagName, attributes) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.attributes = Object.assign({}, attributes);
    this.children = [];
    this.parentElement = null;
    this.listeners = [];
    this.dispatched = [];
    this.textContent = '';
    this.className = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    const value = this.attributes[name];
    return value === undefined ? null : value;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    return child;
  }

  addEventListener(type, handler) {
    this.listeners.push({ type, handler });
  }

  removeEventListener(type, handler) {
    const index = this.listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  isConnected() {
    let node = this;
    while (node !== null && node !== undefined) {
      if (node === document.documentElement) return true;
      node = node.parentElement;
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node !== null && node !== undefined) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  dispatchEvent(event) {
    event.target = this;
    this.dispatched.push(event);
    dispatchFrom(this, event);
    return !event.defaultPrevented;
  }
}

/* Selector support intentionally limited to what the plugin actually queries:
   tag, [attr], tag[attr], [attr="value"], tag[attr="value"]. */
const SELECTOR = /^([a-zA-Z0-9]*)(?:\[([-\w]+)(?:="([^"]*)")?\])?$/;

function matchesSelector(element, selector) {
  const match = SELECTOR.exec(String(selector).trim());
  if (match === null) throw new Error('harness: unsupported selector ' + selector);
  const [, tag, attr, value] = match;
  if (tag !== undefined && tag !== '' && element.tagName !== tag.toUpperCase()) return false;
  if (attr !== undefined) {
    if (!element.hasAttribute(attr)) return false;
    if (value !== undefined && element.getAttribute(attr) !== value) return false;
  }
  return true;
}

class FakeKeyboardEvent {
  constructor(type, init) {
    const opts = init === undefined || init === null ? {} : init;
    this.type = type;
    this.key = opts.key;
    this.code = opts.code;
    this.keyCode = opts.keyCode;
    this.which = opts.which;
    this.shiftKey = opts.shiftKey === true;
    this.ctrlKey = opts.ctrlKey === true;
    this.metaKey = opts.metaKey === true;
    this.altKey = opts.altKey === true;
    this.bubbles = opts.bubbles === true;
    this.cancelable = opts.cancelable === true;
    this.composed = opts.composed === true;
    this.isComposing = false;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediateStopped = false;
    this.target = null;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }
}

const documentElement = new FakeElement('html');
const head = new FakeElement('head');
const body = new FakeElement('body');
documentElement.appendChild(head);
documentElement.appendChild(body);
documentElement.lang = 'zh-CN';
allElements.push(documentElement, head, body);

const document = {
  documentElement,
  head,
  body,
  activeElement: body,
  createElement(tagName) {
    const element = new FakeElement(tagName);
    allElements.push(element);
    return element;
  },
  querySelector(selector) {
    for (const element of allElements) {
      if (element.isConnected() && matchesSelector(element, selector)) return element;
    }
    return null;
  },
  querySelectorAll(selector) {
    return allElements.filter((element) => element.isConnected() && matchesSelector(element, selector));
  },
  addEventListener() {},
  removeEventListener() {},
};

const windowListeners = [];
const window = {
  addEventListener(type, handler, capture) {
    windowListeners.push({ type, handler, capture: capture === true });
  },
  removeEventListener(type, handler) {
    const index = windowListeners.findIndex((entry) => entry.type === type && entry.handler === handler);
    if (index >= 0) windowListeners.splice(index, 1);
  },
  __ModuleLoader__: undefined,
};

function dispatchFrom(target, event) {
  for (const entry of windowListeners.slice()) {
    if (entry.capture !== true) continue;
    if (event.immediateStopped === true) return;
    entry.handler(event);
  }
  for (const entry of target.listeners.slice()) {
    if (event.immediateStopped === true) return;
    entry.handler(event);
  }
}

function fireKeyDown(target, init) {
  const event = new FakeKeyboardEvent('keydown', init);
  event.target = target;
  dispatchFrom(target, event);
  return event;
}

const reactStub = {
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    return { type, props: props === null || props === undefined ? {} : props, children };
  },
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
};

/* ---------------------------------------------------------------- run bundle */

let manifest = null;
let factory = null;

window.__ModuleLoader__ = {
  load(spec) {
    manifest = spec;
    factory = spec.factory;
  },
};

const sandbox = {
  window,
  document,
  KeyboardEvent: FakeKeyboardEvent,
  Element: FakeElement,
  console,
};

vm.runInNewContext(CLIENT_SOURCE, sandbox, { filename: 'client.js' });

check('client.js 必须调用 window.__ModuleLoader__.load', manifest !== null);
assertEqual('load id 必须等于 package.json name', manifest === null ? null : manifest.id, PACKAGE.name);
check('factory 必须是函数', typeof factory === 'function');

const plugin = typeof factory === 'function' ? factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error('harness: unexpected require(' + name + ')');
}) : null;

check('factory 必须返回插件对象', plugin !== null && typeof plugin === 'object');
check('插件必须声明 inject', Array.isArray(plugin === null ? null : plugin.inject));
check('插件必须暴露 apply', typeof (plugin === null ? null : plugin.apply) === 'function');

/* ------------------------------------------------------------------- apply */

const cleanups = [];
const registered = [];

const ctx = {
  effect(effect) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    return cleanup;
  },
  slots: {
    inject(name, register) {
      return register();
    },
    register(spec, component) {
      registered.push({ spec, component });
      return () => {};
    },
  },
};

if (plugin !== null && typeof plugin.apply === 'function') plugin.apply(ctx);

/* --- hint text ---------------------------------------------------------- */

const styleTag = document.querySelector('style[data-plugin-css="dsh-no-enter-send"]');
check('必须注入样式表', styleTag !== null);
const css = styleTag === null ? '' : styleTag.textContent;
check('样式必须包含输入框灰色提示', css.indexOf('已屏蔽Enter 发送') >= 0, css.slice(0, 120));
check('提示必须挂在占位符节点上', css.indexOf('[data-composer-placeholder]::after') >= 0);
check('样式必须禁用指针事件', css.indexOf('pointer-events: none') >= 0);

assertEqual('必须注册一个输入框控件', registered.length, 1);
const caption = registered.length === 0 ? null : registered[0];
assertEqual('注册槽位', caption === null ? null : caption.spec.name, 'conversation.input.right');
const rendered = caption === null ? null : caption.component();
assertEqual('提示文案', rendered === null ? null : rendered.children[0], '已屏蔽Enter 发送');
assertEqual('提示类名', rendered === null ? null : rendered.props.className, 'dsnes-hint');

check('必须暴露调试句柄', typeof window.__dshNoEnterSend === 'object' && window.__dshNoEnterSend !== null);
assertEqual('调试句柄版本', window.__dshNoEnterSend === undefined ? null : window.__dshNoEnterSend.version, 1);

/* --- composer fixture ---------------------------------------------------- */

function createComposer() {
  const card = document.createElement('div');
  card.setAttribute('data-composer-card', '');
  const input = document.createElement('div');
  input.setAttribute('data-composer-input', '');
  input.__lexicalEditor = {};
  card.appendChild(input);
  body.appendChild(card);
  const counts = { sends: 0, breaks: 0 };
  /* Stand-in for the composer's own keymap: a plain Enter submits, a
     Shift+Enter inserts a line break. A handler that never runs proves the
     key press was intercepted before it reached the editor. */
  input.addEventListener('keydown', (event) => {
    if (event.defaultPrevented === true) return;
    if (event.shiftKey === true) counts.breaks += 1;
    else counts.sends += 1;
  });
  return { card, input, counts };
}

/* --- Enter is a line break, never a send -------------------------------- */

{
  const { input, counts } = createComposer();
  const event = fireKeyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  assertEqual('Enter 必须被 preventDefault', event.defaultPrevented, true);
  assertEqual('Enter 必须阻断后续监听', event.immediateStopped, true);
  assertEqual('Enter 不能触发送', counts.sends, 0);
  assertEqual('Enter 必须变成换行', counts.breaks, 1);
  const replay = input.dispatched.filter((item) => item.type === 'keydown');
  assertEqual('必须重放一次按键', replay.length, 1);
  assertEqual('重放必须是 Shift+Enter', replay[0] === undefined ? null : replay[0].shiftKey, true);
}

/* --- bounded modifiers: blocked as a send, no extra line break --------- */

{
  const { input, counts } = createComposer();
  const event = fireKeyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, cancelable: true });
  assertEqual('Ctrl+Enter 必须被拦截', event.defaultPrevented, true);
  assertEqual('Ctrl+Enter 不能触发送', counts.sends, 0);
  assertEqual('Ctrl+Enter 不插入换行', counts.breaks, 0);
}

/* --- typing gestures and open menus pass through ----------------------- */

{
  const { input, counts } = createComposer();
  const composing = new FakeKeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  composing.isComposing = true;
  composing.target = input;
  dispatchFrom(input, composing);
  assertEqual('输入法组字中的 Enter 必须放行', composing.defaultPrevented, false);
  assertEqual('组字中的 Enter 不能被当作换行', counts.breaks, 0);

  const menu = document.createElement('div');
  menu.setAttribute('data-trigger-menu', '');
  body.appendChild(menu);
  const withMenu = fireKeyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  assertEqual('命令菜单打开时 Enter 必须放行', withMenu.defaultPrevented, false);
  body.removeChild(menu);
}

/* --- Enter outside the composer keeps native behaviour ------------------ */

{
  const { input } = createComposer();
  const dialogInput = document.createElement('input');
  body.appendChild(dialogInput);
  const event = fireKeyDown(dialogInput, { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  assertEqual('输入框之外的 Enter 必须放行', event.defaultPrevented, false);
  assertEqual('输入框之外的 Enter 不能重放', dialogInput.dispatched.length, 0);
  check('composer fixture 仍然存在', input.isConnected());
}

/* --- focus fallback: window-level Enter with no useful target ---------- */

{
  const { input, counts } = createComposer();
  document.activeElement = input;
  const event = fireKeyDown(body, { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  assertEqual('焦点兜底必须拦截', event.defaultPrevented, true);
  assertEqual('焦点兜底必须插入换行', counts.breaks, 1);
  document.activeElement = body;
}

/* --- language switch --------------------------------------------------- */

{
  documentElement.lang = 'en-US';
  check('英文环境提示必须切换', window.__dshNoEnterSend.hint() === 'Enter is blocked · click to send');
  documentElement.lang = 'zh-CN';
  check('中文环境提示必须保持', window.__dshNoEnterSend.hint() === '已屏蔽Enter 发送');
}

/* --- teardown ---------------------------------------------------------- */

{
  for (const cleanup of cleanups) cleanup();
  assertEqual('卸载必须移除样式表', document.querySelector('style[data-plugin-css="dsh-no-enter-send"]'), null);
  const { input } = createComposer();
  const event = fireKeyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, cancelable: true });
  assertEqual('卸载后 Enter 必须恢复原状', event.defaultPrevented, false);
}

/* ------------------------------------------------------------------ report */

const total = passed + failures.length;
if (failures.length > 0) {
  console.error('FAIL ' + failures.length + '/' + total);
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('PASS ' + total + '/' + total);
