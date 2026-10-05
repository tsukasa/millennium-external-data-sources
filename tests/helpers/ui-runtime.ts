import type { GameDetails, GameDetailField } from '../../frontend/game-details/manager';
import type { GlobalFeedSettings } from '../../frontend/feed/types';
import type { NativeToggleProps, NativeDropdownProps } from '../../frontend/hooks/use-native-controls';
import { mock } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, Component, createElement as h, type ReactNode, type InputHTMLAttributes } from 'react';

interface MockTextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  description?: ReactNode;
  inlineControls?: ReactNode;
  mustBeNumeric?: boolean;
  rangeMin?: number;
  rangeMax?: number;
}
interface MockDropdownOption { data: string | number; label: string }
interface MockDropdownProps {
  rgOptions: MockDropdownOption[];
  selectedOption: string | number;
  onChange(option: MockDropdownOption): void;
  menuLabel?: string;
  disabled?: boolean;
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
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true });
// React's input-event detection needs the browser globals before initialization.
export const { createRoot } = await import('react-dom/client');
class NativeToggleField extends Component<NativeToggleProps> {
  OnToggleChange(value: boolean) { this.props.onChange(value); }
  render() {
    const { label, checked, disabled } = this.props;
    return h('div', { 'data-native-toggle': true }, h('span', null, label),
      h('button', { type: 'button', role: 'checkbox', 'aria-checked': checked, disabled,
        onClick: () => this.OnToggleChange(!checked) }));
  }
}
const NativeDropdownField = ({ label, description, rgOptions, selectedOption, disabled, onChange, contextMenuPositionOptions }: NativeDropdownProps) => {
  const dropDownControlRef = contextMenuPositionOptions?.bMatchWidth;
  const childrenContainerWidth = 'fixed';
  return h('div', { 'data-native-dropdown': `${childrenContainerWidth}:${dropDownControlRef}` },
    h('span', null, label), h('small', null, description), h('select', { value: selectedOption, disabled,
      onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) => onChange(rgOptions.find(option => option.data === Number(event.target.value))!) },
      rgOptions.map(option => h('option', { key: option.data, value: option.data }, option.label))));
};
export const discoveryDispatcher: Record<string, any> = {};
mock.module('millennium', () => ({
  definePlugin: (initialize: () => unknown) => initialize,
  findClassModule: (filter: (value: any) => boolean) => runtime.nativeClassCandidates.find(filter),
  findModule: (filter: (value: any) => boolean) => runtime.libraryModule && filter(runtime.libraryModule) ? runtime.libraryModule : undefined,
  getReactInstance: () => undefined,
  applyHookStubs: () => { runtime.savedDispatcher = { ...discoveryDispatcher }; return discoveryDispatcher; },
  removeHookStubs: () => {
    for (const key of Object.keys(discoveryDispatcher)) delete discoveryDispatcher[key];
    Object.assign(discoveryDispatcher, runtime.savedDispatcher);
  },
  Button: ({ children, ...props }: import('react').ButtonHTMLAttributes<HTMLButtonElement>) => h('button', props, children),
  DialogControlsSection: ({ children }: { children: ReactNode }) => h('div', { className: 'DialogControlsSection' }, children),
  DialogSubHeader: ({ children }: { children: ReactNode }) => h('div', { className: 'DialogSubHeader' }, children),
  TextField: ({ label, description, inlineControls, mustBeNumeric: _numeric, rangeMin, rangeMax, ...props }: MockTextFieldProps) => {
    const contents = h('div', { className: 'DialogInput_Wrapper _DialogLayout' },
      h('input', { ...props, type: _numeric ? 'number' : 'text', min: rangeMin, max: rangeMax, 'data-steam-text-field': true }), inlineControls);
    return h('div', { className: label ? 'DialogInputLabelGroup _DialogLayout DialogRequirementLabel' : undefined },
      label && h('div', { className: 'DialogLabel' }, label), contents,
      description && h('div', { className: 'DialogLabelExplainer' }, description));
  },
  findModuleExport: (filter: (value: unknown) => boolean) =>
    runtime.nativeModuleCandidates.find(filter) ?? (String(filter).includes('dropDownControlRef') ? NativeDropdownField
      : filter(NativeToggleField) ? NativeToggleField : undefined),
  DialogCheckbox: ({ label, checked, disabled, onChange, className }: NativeToggleProps & { className?: string }) =>
    h('label', { className }, h('input', { type: 'checkbox', checked, disabled,
      onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => onChange(event.target.checked) }), label),
  DropdownItem: (): null => null,
  Dropdown: ({ rgOptions, selectedOption, onChange, menuLabel, disabled }: MockDropdownProps) => h('select', { 'data-native-dropdown': true, value: selectedOption,
    'aria-label': menuLabel, disabled,
    onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) =>
      onChange(rgOptions.find(option => String(option.data) === event.target.value)!) },
    rgOptions.map(option => h('option', { key: option.data, value: option.data }, option.label))),
  Field: ({ label, description, children }: MockFieldProps) =>
    h('div', { className: 'Field Background Panel' }, h('div', null, label, h('small', null, description)), children),
  afterPatch: (object: Record<string, unknown>, property: string, handler: (args: unknown[], result: unknown) => unknown) => {
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

export const id = '3900360037', otherId = '2436693853', url = 'https://example.com/feed';
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
    getFeedSources: async () => Object.fromEntries([...new Set([...Object.keys(runtime.saved), ...Object.keys(runtime.shown), ...Object.keys(runtime.maxed)])]
      .map(key => [key, { url: runtime.saved[key] || '', showFeedInWhatsNew: runtime.shown[key], maxItemsFromFeedInWhatsNew: runtime.maxed[key] }])),
    getFeedRemovedItems: async () => [...runtime.removed],
    getGameDetails: async () => structuredClone(runtime.savedDetails),
    setGameDetail: async (key: string, field: GameDetailField, value: string) => {
      const details = runtime.savedDetails[key] ||= {};
      const normalized = field === 'developer' || field === 'publisher' || field === 'tags' ? JSON.parse(value) as string[] : value;
      if (normalized.length) Object.assign(details, { [field]: normalized });
      else delete details[field];
      if (!Object.keys(details).length) delete runtime.savedDetails[key];
      return true;
    },
    clearGameDetails: async (key: string) => { delete runtime.savedDetails[key]; return true; },
    addFeedRemovedItem: async (articleUrl: string) => { if (!runtime.removed.includes(articleUrl)) runtime.removed.push(articleUrl); return true; },
    saveFeedSource: async (key: string, value: string, showInWhatsNew: boolean) => { if (value.includes('fail')) throw new Error('disk error'); runtime.saved[key] = value; runtime.shown[key] = showInWhatsNew; return true; },
    setShowFeedInWhatsNew: async (key: string, value: boolean) => { runtime.shown[key] = value; return true; },
    setMaxItemsFromFeedInWhatsNew: async (key: string, value: number) => { runtime.maxed[key] = value; return true; },
    clearFeedSource: async (key: string) => { delete runtime.saved[key]; delete runtime.shown[key]; delete runtime.maxed[key]; return true; },
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
