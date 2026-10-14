import type { GameDetails, GameDetailField } from '../../frontend/game-details/manager';
import type { GlobalFeedSettings } from '../../frontend/feed/types';
import { mock } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h, type ReactNode, type InputHTMLAttributes } from 'react';

interface MockTextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  description?: ReactNode;
  inlineControls?: ReactNode;
  mustBeNumeric?: boolean;
  rangeMin?: number;
  rangeMax?: number;
  bShowClearAction?: boolean;
}
interface MockDropdownOption { data: string | number; label: string }
interface MockDropdownProps {
  rgOptions: MockDropdownOption[];
  selectedOption: string | number;
  onChange(option: MockDropdownOption): void;
  menuLabel?: string;
  disabled?: boolean;
}
interface MockToggleFieldProps {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}
interface MockDropdownItemProps extends MockDropdownProps {
  label: ReactNode;
  description?: ReactNode;
}
interface MockFieldProps {
  label: ReactNode;
  description: ReactNode;
  children: ReactNode;
}

interface UIRuntime {
  nativeModuleCandidates: unknown[];
  nativeClassCandidates: any[];
  libraryModule?: Record<string, unknown>;
  savedDispatcher: Record<string, any>;
  saved: Record<string, string>;
  shown: Record<string, boolean>;
  maxed: Record<string, number>;
  removed: string[];
  savedDetails: Record<string, GameDetails>;
  globalFeedSettings: GlobalFeedSettings;
}
export const runtime: UIRuntime = {
  nativeModuleCandidates: [],
  nativeClassCandidates: [],
  libraryModule: undefined,
  savedDispatcher: {},
  saved: {},
  shown: {},
  maxed: {},
  removed: [],
  savedDetails: {},
  globalFeedSettings: { refreshIntervalMinutes: 10, concurrentFetches: 2 },
};

export const dom = new JSDOM('<body></body>', { url: 'https://steamloopback.host' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true,
});
// React's input-event detection needs the browser globals before initialization.
export const { createRoot } = await import('react-dom/client');
export const discoveryDispatcher: Record<string, any> = {};

/** Millennium's tree search: depth-first over the walkable keys of every object. */
function findInTree(node: any, filter: (element: any) => boolean, { walkable }: { walkable?: string[] } = {}): any {
  if (!node || typeof node !== 'object')
    return null;
  if (filter(node))
    return node;
  const children = Array.isArray(node) ? node : (walkable ?? Object.keys(node)).map(key => node[key]);
  for (const child of children) {
    const found = findInTree(child, filter, { walkable });
    if (found)
      return found;
  }
  return null;
}
const findInReactTree = (node: any, filter: (element: any) => boolean) =>
  findInTree(node, filter, { walkable: ['props', 'children', 'child', 'sibling'] });

/** Records DevTools output of Millennium's Logger. */
export const loggerOutput: { level: string; args: unknown[] }[] = [];
class MockLogger {
  log = (...args: unknown[]) => { loggerOutput.push({ level: 'log', args }); };
  debug = (...args: unknown[]) => { loggerOutput.push({ level: 'debug', args }); };
  warn = (...args: unknown[]) => { loggerOutput.push({ level: 'warn', args }); };
  error = (...args: unknown[]) => { loggerOutput.push({ level: 'error', args }); };
}

mock.module('millennium', () => ({
  definePlugin: (initialize: () => unknown) => initialize,
  findClassModule: (filter: (value: any) => boolean) => runtime.nativeClassCandidates.find(filter),
  findModuleDetailsByExport: (filter: (value: any, name?: string) => boolean) => {
    const match = Object.entries(runtime.libraryModule ?? {}).find(([name, value]) => filter(value, name));
    return match
      ? [runtime.libraryModule, match[1], match[0], 'library']
      : [undefined, undefined, undefined, undefined];
  },
  getReactInstance: () => undefined,
  applyHookStubs: () => { runtime.savedDispatcher = { ...discoveryDispatcher }; return discoveryDispatcher; },
  removeHookStubs: () => {
    for (const key of Object.keys(discoveryDispatcher)) delete discoveryDispatcher[key];
    Object.assign(discoveryDispatcher, runtime.savedDispatcher);
  },
  Button: ({ children, ...props }: import('react').ButtonHTMLAttributes<HTMLButtonElement>) =>
    h('button', props, children),
  DialogButton: ({ children, className, ...props }: import('react').ButtonHTMLAttributes<HTMLButtonElement>) =>
    h('button', { type: 'button', ...props, className: `${className || ''} DialogButton` }, children),
  DialogControlsSection: ({ children, className }: { children: ReactNode; className?: string }) =>
    h('div', { className: `DialogControlsSection ${className || ''}` }, children),
  DialogControlsSectionHeader: ({ children }: { children: ReactNode }) =>
    h('div', { className: 'DialogControlsSectionHeader' }, children),
  DialogSubHeader: ({ children }: { children: ReactNode }) => h('div', { className: 'DialogSubHeader' }, children),
  TextField: ({
    label, description, inlineControls, mustBeNumeric: _numeric, rangeMin, rangeMax, bShowClearAction, ...props
  }: MockTextFieldProps) => {
    // Steam clears through the native value setter and an input event.
    const clearInput = (event: import('react').MouseEvent<HTMLElement>) => {
      const input = event.currentTarget.parentElement!.querySelector('input')!;
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, '');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    const contents = h('div', { className: 'DialogInput_Wrapper _DialogLayout' },
      h('input', {
        ...props, type: _numeric ? 'number' : 'text', min: rangeMin, max: rangeMax, 'data-steam-text-field': true,
      }),
      bShowClearAction && props.value && h('div', { className: 'DialogInput_ClearAction', onClick: clearInput }),
      inlineControls);
    return h('div', { className: label ? 'DialogInputLabelGroup _DialogLayout DialogRequirementLabel' : undefined },
      label && h('div', { className: 'DialogLabel' }, label), contents,
      description && h('div', { className: 'DialogLabelExplainer' }, description));
  },
  findModuleExport: (filter: (value: unknown) => boolean) => runtime.nativeModuleCandidates.find(filter),
  findInTree,
  findInReactTree,
  Logger: MockLogger,
  Toggle: ({ value, disabled, onChange }: { value: boolean; disabled?: boolean; onChange(checked: boolean): void }) =>
    h('button', { type: 'button', role: 'checkbox', 'aria-checked': value, disabled, onClick: () => onChange(!value) }),
  DialogCheckbox: ({ label, checked, disabled, onChange, className }: MockToggleFieldProps & { className?: string }) =>
    h('label', { className }, h('input', { type: 'checkbox', checked, disabled,
      onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => onChange(event.target.checked) }), label),
  DropdownItem: ({ label, description, rgOptions, selectedOption, disabled, onChange }: MockDropdownItemProps) =>
    h('div', { 'data-native-dropdown': true }, h('span', null, label), h('small', null, description),
      h('select', { value: selectedOption, disabled,
        onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) =>
          onChange(rgOptions.find(option => String(option.data) === event.target.value)!) },
        rgOptions.map(option => h('option', { key: option.data, value: option.data }, option.label)))),
  Dropdown: ({ rgOptions, selectedOption, onChange, menuLabel, disabled }: MockDropdownProps) =>
    h('select', { 'data-native-dropdown': true, value: selectedOption, 'aria-label': menuLabel, disabled,
      onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) =>
        onChange(rgOptions.find(option => String(option.data) === event.target.value)!) },
      rgOptions.map(option => h('option', { key: option.data, value: option.data }, option.label))),
  Field: ({ label, description, children }: MockFieldProps) =>
    h('div', { className: 'Field Background Panel' }, h('div', null, label, h('small', null, description)), children),
  afterPatch: (object: Record<string, unknown>, property: string,
    handler: (args: unknown[], result: unknown) => unknown) => {
    const original = object[property] as (...args: unknown[]) => unknown;
    object[property] = function(this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      return handler(args, result) ?? result;
    };
    return { unpatch: () => { object[property] = original; } };
  },
}));
export const { FeedManager } = await import('../../frontend/feed/manager');
export const { GameDetailsManager } = await import('../../frontend/game-details/manager');
export const { daysInMonth, isCalendarDate } = await import('../../frontend/game-details/calendar-date');
export const { registerGameDetails } = await import('../../frontend/steam/game-details-store');
export const { ExternalGameDetails } = await import('../../frontend/components/game-properties/external-game-details');
export const { registerShortcutRemoval } = await import('../../frontend/steam/shortcut-removal');
export const { createLibraryLayout } = await import('../../frontend/steam/library-layout');
export const { ExternalNewsSource } = await import('../../frontend/components/game-properties/external-news-source');
export const { PluginConfiguration } = await import('../../frontend/components/plugin-configuration');
export const { discoverNativeNews } = await import('../../frontend/steam/news-discovery');
export const { registerLibrary } = await import('../../frontend/steam/library');
export const { useAsyncStatus } = await import('../../frontend/hooks/use-async-status');
export const { registerActivityComponents } = await import('../../frontend/steam/activity-component-hooks');
export const { registerWhatsNew } = await import('../../frontend/steam/whats-new');
export const { registerProperties } = await import('../../frontend/steam/properties');
export const { initI18n, getPluginI18nString } = await import('../../frontend/i18n');

export const id = '3900360037';
export const otherId = '2436693853';
export const url = 'https://example.com/feed';
export function installBackend(): void {
  runtime.saved = {};
  runtime.shown = {};
  runtime.maxed = {};
  runtime.removed = [];
  runtime.savedDetails = {};
  runtime.globalFeedSettings = { refreshIntervalMinutes: 10, concurrentFetches: 2 };
  Object.assign(globalThis, { backend: {
    getFeedSettings: async () => runtime.globalFeedSettings,
    setFeedSettings: async (refreshIntervalMinutes: number, concurrentFetches: number) => {
      runtime.globalFeedSettings = { refreshIntervalMinutes, concurrentFetches }; return true;
    },
    // Actual Millennium FFI decodes the backend JSON before returning it.
    getFeedSources: async () => {
      const keys = new Set([runtime.saved, runtime.shown, runtime.maxed].flatMap(Object.keys));
      return Object.fromEntries([...keys].map(key => [key, {
        url: runtime.saved[key] || '',
        showFeedInWhatsNew: runtime.shown[key],
        maxItemsFromFeedInWhatsNew: runtime.maxed[key],
      }]));
    },
    getFeedRemovedItems: async () => [...runtime.removed],
    getGameDetails: async () => structuredClone(runtime.savedDetails),
    setGameDetail: async (key: string, field: GameDetailField, value: string) => {
      const details = runtime.savedDetails[key] ||= {};
      const isList = field === 'developer' || field === 'publisher' || field === 'tags';
      const normalized = isList ? JSON.parse(value) as string[] : value;
      if (normalized.length) Object.assign(details, { [field]: normalized });
      else delete details[field];
      if (!Object.keys(details).length) delete runtime.savedDetails[key];
      return true;
    },
    clearGameDetails: async (key: string) => { delete runtime.savedDetails[key]; return true; },
    addFeedRemovedItem: async (articleUrl: string) => {
      if (!runtime.removed.includes(articleUrl)) runtime.removed.push(articleUrl);
      return true;
    },
    saveFeedSource: async (key: string, value: string, showInWhatsNew: boolean) => {
      if (value.includes('fail')) throw new Error('disk error');
      runtime.saved[key] = value;
      runtime.shown[key] = showInWhatsNew;
      return true;
    },
    setShowFeedInWhatsNew: async (key: string, value: boolean) => { runtime.shown[key] = value; return true; },
    setMaxItemsFromFeedInWhatsNew: async (key: string, value: number) => { runtime.maxed[key] = value; return true; },
    clearFeedSource: async (key: string) => {
      delete runtime.saved[key];
      delete runtime.shown[key];
      delete runtime.maxed[key];
      return true;
    },
    fetchFeed: async () => JSON.stringify({ url, xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' }),
  } });
}
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Bypass React's value tracker so it sees a user edit rather than a programmatic assignment. */
export async function typeText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus();
    const win = input.ownerDocument.defaultView!;
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
}

export async function selectOption(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    const win = select.ownerDocument.defaultView!;
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  });
}
