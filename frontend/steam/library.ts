import { retryInstall } from './retry-install';
import { POPUP_DESKTOP_CLIENT_ACTIVITY } from '../constants';
import { findClassModule, findInTree, findModuleDetailsByExport, getReactInstance } from 'millennium';
import { createLibraryLayout, type LayoutRenderer, type SeekTarget, type LayoutClasses } from './library-layout';
import { steam, type AppOverview } from './client';
import { discoverNativeNews, NativeNewsUnavailableError, type NativeBindings } from './news-discovery';
import { registerWhatsNew } from './whats-new';
import { registerActivityStore } from './activity-store';
import { registerActivityComponents } from './activity-component-hooks';
import { MethodHooks } from './method-hooks';
import type { FeedManager } from '../feed/manager';
import { log } from '../logger';

interface LayoutContext {
  _currentValue: LayoutRenderer;
  _currentValue2: LayoutRenderer;
  Provider: unknown;
}

interface LayoutInstance {
  GetSections: unknown;
  RegisterSection: unknown;
  forceUpdate(): void;
}

interface LayoutPrototype {
  GetSections(overview: Pick<AppOverview, 'appid'>, ...args: unknown[]): Set<string>;
}

interface LayoutClass {
  prototype: LayoutPrototype;
}

interface LayoutBindings {
  layoutClass: LayoutClass;
  context: LayoutContext;
  seek: SeekTarget;
  classes: LayoutClasses;
}

/**
 * Find the layout bindings for Steam's library layout.
 * Discover by component capabilities, never by build-specific webpack IDs.
 */
function findBindings(): LayoutBindings | undefined {
  const [module, layoutClass] = findModuleDetailsByExport(value => value?.prototype?.GetSections
    && value.prototype.RegisterSection
    && value.prototype.SeekToSection) as [Record<string, unknown> | undefined, LayoutClass | undefined, ...unknown[]];

  if (!module)
    return undefined;

  const values = Object.values(module) as any[];
  const context = values.find(value => value?.Provider
    && typeof value._currentValue === 'function'
  ) as LayoutContext | undefined;

  const seek = values.find(value => typeof value?.prototype?.render === 'function'
    && String(value.prototype.render).includes('RegisterSection')
    && String(value.prototype.render).includes('props.name')
  ) as SeekTarget | undefined;

  const classes = findClassModule(value => value.LeftColumn
    && value.RightColumn
    && value.ColumnContainer
    && value.SeekTarget
  );

  if (!layoutClass || !context || !seek || !classes)
    return undefined;

  return {
    layoutClass,
    context,
    seek,
    classes: {
      LeftColumn: classes.LeftColumn,
      ColumnContainer: classes.ColumnContainer
    }
  };
}

/**
 * Refresh an already open desktop page after installing the layout wrapper.
 * This ensures that any changes to the layout are immediately reflected.
 */
function refreshOpenLayout(classes: LayoutClasses) {
  const doc = steam().g_PopupManager?.GetExistingPopup(POPUP_DESKTOP_CLIENT_ACTIVITY)?.window?.document;
  // Use the discovered class; the unhashed name covers themes that add it.
  const anchor = doc?.querySelector(`.${classes.ColumnContainer}, .ColumnContainer`);

  if (!anchor)
    return;

  const layout = findInTree(getReactInstance(anchor), fiber => {
    const instance = fiber.stateNode as LayoutInstance | undefined;
    return !!instance?.GetSections && !!instance.RegisterSection && typeof instance.forceUpdate === 'function';
  }, { walkable: ['return'] });

  (layout?.stateNode as LayoutInstance | undefined)?.forceUpdate();
}

/**
 * Installs the activity integration once Steam's news modules are loaded.
 * Returns undefined while they are missing; structural mismatches throw.
 */
function installNewsIntegration(feedManager: FeedManager,
  reportUnavailable: (reason: string) => void): (() => void) | undefined {
  let native: NativeBindings;
  try {
    native = discoverNativeNews();
  } catch (error) {
    if (error instanceof NativeNewsUnavailableError) {
      reportUnavailable(error.message);
      return undefined;
    }
    throw error;
  }

  let unregisterComponents: (() => void) | undefined;
  let unregisterActivity: (() => void) | undefined;
  try {
    unregisterComponents = registerActivityComponents(feedManager, native);
    unregisterActivity = registerActivityStore(feedManager, native);
  } catch (error) {
    unregisterActivity?.();
    unregisterComponents?.();
    throw error;
  }

  // What's New may become available after Activity; retry it independently.
  const restoreWhatsNew = installWhatsNewIntegration(feedManager, native);
  return () => {
    restoreWhatsNew();
    unregisterActivity?.();
    unregisterComponents?.();
  };
}

function installWhatsNewIntegration(feedManager: FeedManager, native: NativeBindings): () => void {
  let restore: (() => void) | undefined;
  const stopInstalling = retryInstall(() => {
    restore = registerWhatsNew(feedManager, native);
    return !!restore;
  }, 500, { name: "What's New installation" });

  return () => {
    stopInstalling();
    restore?.();
  };
}

function installLayoutIntegration(feedManager: FeedManager): (() => void) | undefined {
  const bindings = findBindings();
  if (!bindings)
    return undefined;

  const hooks = new MethodHooks();
  const { layoutClass, context, seek, classes } = bindings;
  const original = context._currentValue;
  const original2 = context._currentValue2 || original;
  const layout = createLibraryLayout(original, seek, classes, feedManager);
  const layout2 = original2 === original ? layout : createLibraryLayout(original2, seek, classes, feedManager);

  // Native providers retain precedence; both React renderer slots are restored on unload.
  const restore = () => {
    hooks.restore();
    if (context._currentValue === layout)
      context._currentValue = original;
    if (context._currentValue2 === layout2)
      context._currentValue2 = original2;
  };

  try {
    // Big Picture gates Activity on GetSections; leave Steam's memoized Set untouched.
    hooks.wrap(layoutClass.prototype, 'GetSections', (original, _instance, [overview]) => {
      const sections = original();
      return sections?.has('nonsteam') && feedManager.hasFeed(overview.appid)
        ? new Set([...sections, 'activityrollup', 'activity'])
        : sections;
    });
    context._currentValue = layout;
    context._currentValue2 = layout2;
    refreshOpenLayout(classes);
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

export function registerLibrary(feedManager: FeedManager): () => void {
  let restoreNews: (() => void) | undefined;
  let restoreLayout: (() => void) | undefined;
  let lastUnavailable: string | undefined;

  // Missing modules are polled; report each distinct reason once.
  const reportUnavailable = (reason: string) => {
    if (reason !== lastUnavailable)
      log.debug(`Waiting for Steam: ${reason}`);
    lastUnavailable = reason;
  };

  // Steam loads library modules lazily, including on a Big Picture cold start.
  const stopInstalling = retryInstall(() => {
    restoreNews ||= installNewsIntegration(feedManager, reportUnavailable);
    if (!restoreNews)
      return false;
    restoreLayout = installLayoutIntegration(feedManager);
    return !!restoreLayout;
  }, 500, { name: 'Library installation' });

  return () => {
    stopInstalling();
    restoreLayout?.();
    restoreNews?.();
  };
}
