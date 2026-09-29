import type { CalendarDate } from '../../frontend/release-date/calendar-date';
import type { GlobalFeedSettings } from '../../frontend/feed/types';
import type { NativeToggleProps, NativeDropdownProps } from '../../frontend/hooks/use-native-controls';
import { mock } from 'bun:test';
import { JSDOM } from 'jsdom';
import { Component, createElement as h, type ReactNode, type InputHTMLAttributes } from 'react';

interface MockTextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
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
  savedDates: Record<string, CalendarDate>;
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
  savedDates: {},
  globalFeedSettings: { refreshIntervalMinutes: 10, concurrentFetches: 2 },
};

export const dom = new JSDOM('<body></body>', { url: 'https://steamloopback.host' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true });
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
  findClassModule: (filter: (value: any) => boolean) => runtime.nativeClassCandidates.find(filter),
  findModule: (filter: (value: any) => boolean) => runtime.libraryModule && filter(runtime.libraryModule) ? runtime.libraryModule : undefined,
  getReactInstance: () => undefined,
  applyHookStubs: () => { runtime.savedDispatcher = { ...discoveryDispatcher }; return discoveryDispatcher; },
  removeHookStubs: () => {
    for (const key of Object.keys(discoveryDispatcher)) delete discoveryDispatcher[key];
    Object.assign(discoveryDispatcher, runtime.savedDispatcher);
  },
  Button: (): null => null,
  TextField: ({ mustBeNumeric: _numeric, rangeMin, rangeMax, ...props }: MockTextFieldProps) => h('input', { ...props, type: 'number', min: rangeMin, max: rangeMax, 'data-steam-text-field': true }),
  findModuleExport: (filter: (value: unknown) => boolean) =>
    runtime.nativeModuleCandidates.find(filter) ?? (String(filter).includes('dropDownControlRef') ? NativeDropdownField
      : filter(NativeToggleField) ? NativeToggleField : undefined),
  DialogCheckbox: (): null => null,
  DropdownItem: (): null => null,
  Dropdown: ({ rgOptions, selectedOption, onChange, menuLabel, disabled }: MockDropdownProps) => h('select', { 'data-native-dropdown': true, value: selectedOption,
    'aria-label': menuLabel, disabled,
    onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) =>
      onChange(rgOptions.find(option => String(option.data) === event.target.value)!) },
    rgOptions.map(option => h('option', { key: option.data, value: option.data }, option.label))),
  Field: ({ label, description, children }: MockFieldProps) =>
    h('div', { className: 'Field Background Panel' }, h('div', null, label, h('small', null, description)), children),
  beforePatch: (object: Record<string, unknown>, property: string, handler: (this: unknown, args: unknown[]) => void) => {
    const original = object[property] as (...args: unknown[]) => unknown;
    object[property] = function(this: unknown, ...args: unknown[]) { handler.call(this, args); return original.apply(this, args); };
    return { unpatch: () => { object[property] = original; } };
  },
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
export const { ReleaseDateManager } = await import('../../frontend/release-date/manager');
export const { daysInMonth, isCalendarDate } = await import('../../frontend/release-date/calendar-date');
export const { registerReleaseDates } = await import('../../frontend/steam/release-date-store');
export const { ExternalReleaseDate } = await import('../../frontend/components/game-properties/external-release-date');
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
  runtime.savedDates = {};
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
    getReleaseDates: async () => ({ ...runtime.savedDates }),
    setReleaseDate: async (key: string, year: number, month: number, day: number) => {
      runtime.savedDates[key] = { year, month, day }; return true;
    },
    clearReleaseDate: async (key: string) => { delete runtime.savedDates[key]; return true; },
    addFeedRemovedItem: async (articleUrl: string) => { if (!runtime.removed.includes(articleUrl)) runtime.removed.push(articleUrl); return true; },
    saveFeedSource: async (key: string, value: string, showInWhatsNew: boolean) => { if (value.includes('fail')) throw new Error('disk error'); runtime.saved[key] = value; runtime.shown[key] = showInWhatsNew; return true; },
    setShowFeedInWhatsNew: async (key: string, value: boolean) => { runtime.shown[key] = value; return true; },
    setMaxItemsFromFeedInWhatsNew: async (key: string, value: number) => { runtime.maxed[key] = value; return true; },
    clearFeedSource: async (key: string) => { delete runtime.saved[key]; delete runtime.shown[key]; delete runtime.maxed[key]; return true; },
    fetchFeed: async () => JSON.stringify({ url, xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' }),
  } });
}
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
