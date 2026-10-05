import { retryInstall } from './retry-install';
import { POPUP_DESKTOP_CLIENT_ACTIVITY } from '../constants';
import { findClassModule, findModule, getReactInstance } from 'millennium';
import { createLibraryLayout, type LayoutRenderer, type SeekTarget, type LayoutClasses } from './library-layout';
import { steam, type AppOverview } from './client';
import { discoverNativeNews } from './news-discovery';
import { registerWhatsNew } from './whats-new';
import { registerActivityStore } from './activity-store';
import { registerActivityComponents } from './activity-component-hooks';
import { MethodHooks } from './method-hooks';
import type { FeedManager } from '../feed/manager';

interface LayoutContext {
  _currentValue: LayoutRenderer;
  _currentValue2: LayoutRenderer;
  Provider: unknown
}

interface LayoutInstance {
  GetSections: unknown;
  RegisterSection: unknown;
  forceUpdate(): void
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
  const module = findModule(exports => exports && Object.values(exports).some((value: any) =>
    value?.prototype?.GetSections && value?.prototype?.RegisterSection && value?.prototype?.SeekToSection)
  );

  if (!module)
    return undefined;

  const values = Object.values(module) as any[];
  const layoutClass = values.find(value => value?.prototype?.GetSections
    && value?.prototype?.RegisterSection
    && value?.prototype?.SeekToSection
  ) as LayoutClass | undefined;
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
function refreshOpenLayout() {
  const doc = steam().g_PopupManager?.GetExistingPopup(POPUP_DESKTOP_CLIENT_ACTIVITY)?.window?.document;
  const anchor = doc?.querySelector('.ColumnContainer, .OhSdLYuggDtBcWjYP0j_9');

  if (!anchor)
    return;

  let fiber = getReactInstance(anchor);

  while (fiber) {
    const instance = fiber.stateNode as LayoutInstance | undefined;

    if (instance?.GetSections && instance.RegisterSection && typeof instance.forceUpdate === 'function') {
      instance.forceUpdate();
      return;
    }
    fiber = fiber.return;
  }
}

type ReportInstallError = (stage: string, error: unknown) => void;

function installNewsIntegration(feedManager: FeedManager, reportError: ReportInstallError): (() => void) | undefined {
  let native: ReturnType<typeof discoverNativeNews>;
  try {
    native = discoverNativeNews();
  } catch (error) {
    reportError('Native news discovery', error);
    return undefined;
  }

  let unregisterComponents: (() => void) | undefined;
  let unregisterActivity: (() => void) | undefined;
  try {
    unregisterComponents = registerActivityComponents(feedManager, native);
    unregisterActivity = registerActivityStore(feedManager, native);
  } catch (error) {
    unregisterActivity?.();
    unregisterComponents?.();
    reportError('Activity installation', error);
    return undefined;
  }

  // What's New may become available after Activity; retry it independently.
  const restoreWhatsNew = installWhatsNewIntegration(feedManager, native, reportError);
  return () => {
    restoreWhatsNew();
    unregisterActivity?.();
    unregisterComponents?.();
  };
}

function installWhatsNewIntegration(feedManager: FeedManager, native: ReturnType<typeof discoverNativeNews>,
  reportError: ReportInstallError): () => void {
  let restore: (() => void) | undefined;
  const stopInstalling = retryInstall(() => {
    try {
      restore = registerWhatsNew(feedManager, native);
      return true;
    } catch (error) {
      reportError("What's New installation", error);
      return false;
    }
  }, 500);

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
      return sections?.has('nonsteam') && feedManager.sources[String(overview.appid)]?.url
        ? new Set([...sections, 'activityrollup', 'activity'])
        : sections;
    });
    context._currentValue = layout;
    context._currentValue2 = layout2;
    refreshOpenLayout();
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

export function registerLibrary(feedManager: FeedManager): () => void {
  let restoreNews: (() => void) | undefined;
  let restoreLayout: (() => void) | undefined;
  let lastError: string | undefined;
  const reportError: ReportInstallError = (stage, error) => {
    const message = String(error);
    if (message !== lastError)
      console.error(`[External Data Sources] ${stage} failed:`, error);
    lastError = message;
  };

  // Steam loads library modules lazily, including on a Big Picture cold start.
  const stopInstalling = retryInstall(() => {
    restoreNews ||= installNewsIntegration(feedManager, reportError);
    if (!restoreNews)
      return false;
    try {
      restoreLayout = installLayoutIntegration(feedManager);
      return !!restoreLayout;
    } catch (error) {
      reportError('Library layout installation', error);
      return false;
    }
  }, 500);

  return () => {
    stopInstalling();
    restoreLayout?.();
    restoreNews?.();
  };
}
