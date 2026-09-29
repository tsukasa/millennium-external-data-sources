import { findClassModule, findModule, getReactInstance } from 'millennium';
import { createLibraryLayout, type LayoutRenderer, type SeekTarget } from './renderers/library-layout';
import { steam } from './steam';
import type { Sources } from './sources';
import { discoverNativeNews } from './native/discovery';
import { createNativeNews } from './native/news';

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

type SectionSet = Set<string>;

interface LayoutClass {
  prototype: { GetSections(overview: { appid: number }, ...args: unknown[]): SectionSet }
}

/** Discover by component capabilities, never by build-specific webpack IDs. */
function findBindings() {
  const module = findModule(exports => exports && Object.values(exports).some((value: any) =>
    value?.prototype?.GetSections && value?.prototype?.RegisterSection && value?.prototype?.SeekToSection)
  );

  if (!module) return
    undefined;

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

/** Refresh open pages once on installation/removal, without a DOM observer. */
function refreshOpenLayout() {
  const doc = steam().g_PopupManager?.GetExistingPopup('SP Desktop_uid0')?.window?.document;
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

export function registerLibrary(sources: Sources): () => void {
  let restore: (() => void) | undefined;
  let discoveryError: string | undefined;
  const install = () => {
    const bindings = findBindings();

    if (!bindings)
      return false;

    let native;
    try {
      native = createNativeNews(discoverNativeNews());
    } catch (error) {
      const message = String(error);
      if (message !== discoveryError) console.error('[External Data Sources] Native news discovery failed:', error);
      discoveryError = message;
      return false;
    }

    const { layoutClass, context, seek, classes } = bindings;
    const original = context._currentValue, original2 = context._currentValue2 || original;
    const originalGetSections = layoutClass.prototype.GetSections;

    const getSections: typeof originalGetSections = function (this: LayoutInstance, overview, ...args) {
      const sections = originalGetSections.call(this, overview, ...args);

      if (sections?.has('nonsteam') && sources.values[String(overview.appid)]) {
        sections.add('activityrollup');
        sections.add('activity');
      }
      return sections;
    };

    const layout = createLibraryLayout(original, seek, classes, sources, native);
    const layout2 = original2 === original ? layout : createLibraryLayout(original2, seek, classes, sources, native);

    // Steam exposes its default renderer through this context. Native providers
    // retain precedence; both React renderer slots are restored on unload.
    context._currentValue = layout;
    context._currentValue2 = layout2;

    layoutClass.prototype.GetSections = getSections;

    const unsubscribe = sources.subscribe(refreshOpenLayout);

    restore = () => {
      unsubscribe();
      if (layoutClass.prototype.GetSections === getSections)
        layoutClass.prototype.GetSections = originalGetSections;

      if (context._currentValue === layout)
        context._currentValue = original;

      if (context._currentValue2 === layout2)
        context._currentValue2 = original2;

      refreshOpenLayout();
    };

    refreshOpenLayout();

    return true;
  };

  const timer = install() ? undefined : setInterval(() => {
    if (install())
      clearInterval(timer);
  }, 500);

  return () => {
    clearInterval(timer);
    restore?.();
  };
}
