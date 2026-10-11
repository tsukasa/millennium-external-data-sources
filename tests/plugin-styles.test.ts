import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h } from 'react';
import { createRoot } from './helpers/ui-runtime';
import { usePluginStyles } from '../frontend/hooks/use-plugin-styles';

function Editor({ children }: { children?: string }) {
  const ref = usePluginStyles();
  return h('div', { ref, className: 'extdatasrc-plugin-game-details-custom-tag-chip' }, children);
}

test('plugin styles share one sheet per document, survive renders, allow themes and clean up', async () => {
  const popup = new JSDOM('<body></body>');
  const containers = [document.createElement('div'), document.createElement('div'), popup.window.document.body];
  document.body.append(...containers.slice(0, 2));
  const roots = containers.map(container => createRoot(container));
  const selector = 'style[data-extdatasrc-plugin="ui"]';
  const theme = document.createElement('style');
  try {
    await act(async () => {
      roots.forEach(root => root.render(h(Editor)));
    });
    expect(document.head.querySelectorAll(selector)).toHaveLength(1);
    expect(popup.window.document.head.querySelectorAll(selector)).toHaveLength(1);
    const sheet = document.head.querySelector<HTMLStyleElement>(selector)!;
    for (const rule of sheet.sheet!.cssRules) {
      for (const selector of (rule as CSSStyleRule).selectorText.split(','))
        expect(selector.trim().startsWith('.extdatasrc-plugin-')).toBe(true);
    }
    const observer = new window.MutationObserver(() => {});
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    for (let render = 0; render < 25; render++) {
      await act(async () => roots[0].render(h(Editor, null, String(render))));
      expect(document.head.querySelector(selector)).toBe(sheet);
      expect(observer.takeRecords()).toHaveLength(0);
    }
    observer.disconnect();
    theme.textContent = '.extdatasrc-plugin-game-details-custom-tag-chip { background: rgb(1, 2, 3); }';
    document.head.append(theme);
    expect(window.getComputedStyle(containers[0].firstElementChild!).backgroundColor).toBe('rgb(1, 2, 3)');
    await act(async () => roots[0].render(null));
    expect(document.head.querySelector(selector)).toBe(sheet);
    await act(async () => roots[1].render(null));
    expect(document.head.querySelector(selector)).toBeNull();
    expect(popup.window.document.head.querySelectorAll(selector)).toHaveLength(1);
    await act(async () => roots[2].render(null));
    expect(popup.window.document.head.querySelector(selector)).toBeNull();
  } finally {
    await act(async () => roots.forEach(root => root.unmount()));
    theme.remove();
    containers.slice(0, 2).forEach(container => container.remove());
    popup.window.close();
  }
});
