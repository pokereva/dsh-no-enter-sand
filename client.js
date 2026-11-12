/**
 * dsh-no-enter-sand — Enter cannot send; only the mouse sends.
 *
 * Why a capture-phase window listener: the composer's Lexical editor handles
 * KEY_ENTER_COMMAND on the contenteditable root (bubble phase) and the shell's
 * shortcut service listens further up. A capture listener on window runs before
 * both, so preventDefault() + stopImmediatePropagation() removes every keyboard
 * send path in one place instead of chasing each handler.
 *
 * Enter is then replayed as Shift+Enter, which this composer treats as a line
 * break, so the key keeps its "new line" meaning. A synthetic flag stops the
 * replayed event from being intercepted a second time.
 *
 * The gray hint appears in two places that never fight for space: appended to
 * the composer's own placeholder line while the draft is empty (so it reads like
 * native ghost text inside the input box), and as a quiet caption in the toolbar
 * next to the send button, which stays visible once typing has started — that is
 * the moment a user is about to press Enter.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-no-enter-sand',
  factory(require) {
    'use strict';

    const { createElement: h } = require('react');
    const STYLE_ID = 'dsh-no-enter-sand';
    const HINT_ZH = '已屏蔽Enter 发送';
    const HINT_EN = 'Enter is blocked · click to send';
    const HINT_CLASS = 'dsnes-hint';

    const state = { synthetic: false };

    function documentLanguage() {
      if (typeof document === 'undefined' || document === null) return '';
      const root = document.documentElement;
      if (root === undefined || root === null || typeof root.lang !== 'string') return '';
      return root.lang.toLowerCase();
    }

    function hintText() {
      return documentLanguage().indexOf('en') === 0 ? HINT_EN : HINT_ZH;
    }

    function quote(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function cssText() {
      return [
        '/* Same gray, same line as the composer placeholder, only while empty. */',
        '[data-composer-placeholder]::after {',
        '  content: " · ' + quote(hintText()) + '";',
        '  color: inherit;',
        '  pointer-events: none;',
        '}',
        '',
        '/* Toolbar caption: stays visible after typing begins. */',
        '.' + HINT_CLASS + ' {',
        '  display: inline-flex;',
        '  align-items: center;',
        '  font-family: var(--dsw-font-family);',
        '  font-size: 12px;',
        '  line-height: 18px;',
        '  color: var(--dsw-alias-label-caption, #9aa0a6);',
        '  white-space: nowrap;',
        '  user-select: none;',
        '  pointer-events: none;',
        '}',
      ].join('\n');
    }

    function headOf() {
      if (typeof document === 'undefined' || document === null) return null;
      const head = document.head;
      return head === undefined || head === null ? null : head;
    }

    function ensureStyles() {
      const head = headOf();
      if (head === null) return function noop() {};
      const selector = 'style[data-plugin-css="' + STYLE_ID + '"]';
      const existing = document.querySelector(selector);
      if (existing !== null && existing !== undefined) {
        existing.textContent = cssText();
        return function noop() {};
      }
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin-css', STYLE_ID);
      tag.textContent = cssText();
      head.appendChild(tag);
      return function removeStyles() {
        const parent = tag.parentElement;
        if (parent !== null && parent !== undefined) parent.removeChild(tag);
      };
    }

    function elementOf(node) {
      if (node === undefined || node === null) return null;
      if (typeof node.closest === 'function') return node;
      if (node.nodeType === 1) return node;
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        return parent === undefined || parent === null ? null : parent;
      }
      const root = node.documentElement;
      return root === undefined || root === null ? null : root;
    }

    function activeInput() {
      if (typeof document === 'undefined' || document === null) return null;
      const active = elementOf(document.activeElement);
      if (active === null) return null;
      const input = active.closest('[data-composer-input]');
      return input === undefined ? null : input;
    }

    /**
     * The text field that owns this event, or null when this Enter belongs to
     * something else (a rename box, a dialog, a button). Only the editor region
     * is intercepted, so controls around the composer keep normal keyboard
     * behaviour. A window-level Enter with no meaningful target resolves through
     * the focused element instead, which covers focus parked on the card.
     */
    function composerInput(node) {
      const element = elementOf(node);
      if (element === null) return null;
      const direct = element.closest('[data-composer-input]');
      if (direct !== null && direct !== undefined) return direct;
      const bare = typeof document !== 'undefined' && document !== null
        && (element === document.body || element === document.documentElement || element === document);
      return bare === true ? activeInput() : null;
    }

    function isTypingGesture(event) {
      return event.isComposing === true || event.keyCode === 229;
    }

    function isEnterGesture(event) {
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.code === 'string' ? event.code : '';
      return key === 'Enter' || key === 'Return' || code === 'Enter'
        || code === 'NumpadEnter' || event.keyCode === 13;
    }

    function triggerMenuOpen() {
      if (typeof document === 'undefined' || document === null) return false;
      return document.querySelector('[data-trigger-menu]') !== null;
    }

    /**
     * Insert a line break by replaying the gesture the composer maps to one.
     * Shift+Enter reaches Lexical's KEY_ENTER_COMMAND handler, which declines it
     * and lets the break be inserted as a line-break node.
     */
    function insertLineBreak(root) {
      if (root === null || root === undefined) return false;
      if (root.__lexicalEditor === undefined) {
        try {
          if (typeof document.execCommand === 'function' && document.execCommand('insertLineBreak') === true) return true;
        } catch (error) {
          /* fall through to the synthetic key */
        }
      }
      if (typeof KeyboardEvent !== 'function') return false;
      state.synthetic = true;
      try {
        const replay = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        root.dispatchEvent(replay);
      } catch (error) {
        return false;
      } finally {
        state.synthetic = false;
      }
      return true;
    }

    function onKeyDownCapture(event) {
      if (state.synthetic === true) return;
      if (event === undefined || event === null) return;
      if (event.defaultPrevented === true) return;
      if (isTypingGesture(event) === true) return;
      if (isEnterGesture(event) !== true) return;
      const input = composerInput(event.target);
      if (input === null) return;
      /* A slash / @ / command menu owns Enter while it is open. */
      if (triggerMenuOpen() === true) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      else if (typeof event.stopPropagation === 'function') event.stopPropagation();
      /* Ctrl/Cmd/Alt+Enter is a shortcut, not typing: swallow it, add nothing. */
      if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return;
      insertLineBreak(input);
    }

    function HintCaption() {
      return h('span', { className: HINT_CLASS, 'aria-hidden': 'true' }, hintText());
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(function stylesEffect() {
          return ensureStyles();
        }, 'dsh-no-enter-sand: styles');

        ctx.effect(function enterEffect() {
          if (typeof window === 'undefined' || window === null) return function noop() {};
          window.addEventListener('keydown', onKeyDownCapture, true);
          return function removeEnterListener() {
            window.removeEventListener('keydown', onKeyDownCapture, true);
          };
        }, 'dsh-no-enter-sand: enter');

        ctx.slots.inject('conversation.input.right', function registerHint() {
          return ctx.slots.register({
            name: 'conversation.input.right',
            id: 'no-enter-hint',
            order: 5,
          }, HintCaption);
        });

        if (typeof window !== 'undefined' && window !== null) {
          window.__dshNoEnterSand = {
            version: 1,
            hint: hintText,
            isEnter: isEnterGesture,
            css: cssText,
          };
        }
      },
    };
  },
});
