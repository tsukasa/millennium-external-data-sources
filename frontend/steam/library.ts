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
 * @returns The discovered layout bindings if found, otherwise undefined.
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

/**
 * Register the library layout wrapper and associated feed manager.
 * @param feedManager The feed manager to use for external news.
 * @returns A function to restore the original layout and unregister the feed manager.
 */
export function registerLibrary(feedManager: FeedManager): () => void {
  let restoreCore: (() => void) | undefined;
  let restoreLayout: (() => void) | undefined;
  let discoveryError: string | undefined;

  const installCore = () => {
    if (restoreCore)
      return true;

    let discovered: ReturnType<typeof discoverNativeNews>;

    try {
      discovered = discoverNativeNews();
    } catch (error) {
      const message = String(error);

      if (message !== discoveryError)
        console.error('[External Data Sources] Native news discovery failed:', error);

      discoveryError = message;
      return false;
    }

    let unregisterComponents: (() => void) | undefined;
    let unregisterActivityStore: (() => void) | undefined;
    try {
      unregisterComponents = registerActivityComponents(feedManager, discovered);
      unregisterActivityStore = registerActivityStore(feedManager, discovered);
    } catch (error) {
      unregisterActivityStore?.();
      unregisterComponents?.();
      const message = String(error);
      if (message !== discoveryError)
        console.error('[External Data Sources] Activity installation failed:', error);
      discoveryError = message;
      return false;
    }

    let unregisterWhatsNew: (() => void) | undefined;
    const installWhatsNew = () => {
      try {
        unregisterWhatsNew = registerWhatsNew(feedManager, discovered);
        return true;
      } catch (error) {
        const message = String(error);
        if (message !== discoveryError)
          console.error('[External Data Sources] What\'s New installation failed:', error);
        discoveryError = message;
        return false;
      }
    };
    const whatsNewTimer = installWhatsNew() ? undefined : setInterval(() => {
      if (installWhatsNew())
        clearInterval(whatsNewTimer);
    }, 500);

    restoreCore = () => {
      clearInterval(whatsNewTimer);
      unregisterWhatsNew?.();
      unregisterActivityStore?.();
      unregisterComponents?.();
    };

    return true;
  };

  const installLayout = () => {
    if (!installCore())
      return false;

    const layoutHooks = new MethodHooks();
    try {
      const bindings = findBindings();

      if (!bindings)
        return false;

      const { layoutClass, context, seek, classes } = bindings;
      const original = context._currentValue, original2 = context._currentValue2 || original;

      // Big Picture gates the native Activity tab on the 'activity' section
      // returned by GetSections.
      // Store events alone cannot expose that tab for non-Steam shortcuts.
      // Return a new Set so Steam's memoized native sections remain untouched.
      layoutHooks.wrap(layoutClass.prototype, 'GetSections', (original, _instance, [overview]) => {
        const sections = original() as Set<string>;
        return sections?.has('nonsteam') && feedManager.values[String(overview.appid)]
          ? new Set([...sections, 'activityrollup', 'activity'])
          : sections;
      });

      const layout = createLibraryLayout(original, seek, classes, feedManager);
      const layout2 = original2 === original ? layout : createLibraryLayout(original2, seek, classes, feedManager);

      // Steam exposes its default renderer through this context. Native providers
      // retain precedence; both React renderer slots are restored on unload.
      restoreLayout = () => {
        layoutHooks.restore();

        if (context._currentValue === layout)
          context._currentValue = original;

        if (context._currentValue2 === layout2)
          context._currentValue2 = original2;
      };

      context._currentValue = layout;
      context._currentValue2 = layout2;

      refreshOpenLayout();

      return true;
    } catch (error) {
      restoreLayout?.();
      restoreLayout = undefined;
      layoutHooks.restore();
      const message = String(error);
      if (message !== discoveryError)
        console.error('[External Data Sources] Library layout installation failed:', error);
      discoveryError = message;
      return false;
    }
  };

  // Steam loads the library modules lazily, including on a Big Picture cold start.
  const timer = installLayout() ? undefined : setInterval(() => {
    if (installLayout())
      clearInterval(timer);
  }, 500);

  return () => {
    clearInterval(timer);
    restoreLayout?.();
    restoreCore?.();
  };
}
