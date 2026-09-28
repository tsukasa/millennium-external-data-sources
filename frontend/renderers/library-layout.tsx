import { cloneElement, isValidElement, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { NewsSection } from '../components/news-section';
import { isNonSteamId } from '../steam';
import type { Sources } from '../sources';

/** CSS class names used to locate the relevant columns in Steam's library layout. */
export interface LayoutClasses {
  LeftColumn: string;
  ColumnContainer: string
}

/** Props passed to Steam's library layout renderer. */
export interface LayoutProps {
  overview: { appid: number };
  parentComponent: { RegisterSection(name: string, element: HTMLElement | null): void };
  setSections: Set<string>;
}

export type LayoutRenderer = (props: LayoutProps) => ReactNode;

export type SeekTarget = ComponentType<{ name: string; parent: LayoutProps['parentComponent']; children?: ReactNode }>;


/*****************************************************************************/
/* Functions                                                                 */
/*****************************************************************************/

/**
 * Wraps Steam's library layout renderer to show external news for configured
 * non-Steam shortcuts in the activity section.
 * @param original Steam's original library layout renderer.
 * @param Seek Component used by Steam to register layout sections.
 * @param classes CSS class names for the library columns.
 * @param sources External news sources and their change notifications.
 * @returns A renderer that adds the external news section when applicable.
 */
export function createLibraryLayout(original: LayoutRenderer, Seek: SeekTarget, classes: LayoutClasses, sources: Sources): LayoutRenderer {
  const subscribe = (notify: () => void) => sources.subscribe(notify);
  const snapshot = () => sources.revision;

  return function ExternalLibraryLayout(props) {
    const revision = useSyncExternalStore(subscribe, snapshot);
    const appId = String(props.overview.appid), url = sources.values[appId];
    const enabled = !!url && isNonSteamId(props.overview.appid) && props.setSections.has('nonsteam');

    // Let Steam create its own SeekTargets. The source-backed sections are
    // added before the native renderer constructs the left column.
    const setSections = enabled ? new Set([...props.setSections, 'activityrollup', 'activity']) : props.setSections;

    const tree = original(setSections === props.setSections ? props : { ...props, setSections });

    if (!enabled)
      return tree;

    const visit = (node: ReactNode, inLeftColumn = false): ReactNode => {
      if (Array.isArray(node))
        return node.map(child => visit(child, inLeftColumn));

      if (!isValidElement<{ className?: string; name?: string; children?: ReactNode }>(node))
        return node;

      // Steam's renderer tree includes elements whose className is not a
      // string (for example, props forwarded from component wrappers).
      const names = typeof node.props.className === 'string'
        ? node.props.className.split(/\s+/).filter(Boolean)
        : [];

      const hasClass = (value: string) => value
        .split(' ')
        .every(name => names.includes(name)
      );

      if (inLeftColumn && node.type === Seek && node.props.name === 'activityrollup')
        return cloneElement(node, undefined, null);

      if (inLeftColumn && node.type === Seek && node.props.name === 'activity')
        return cloneElement(node, undefined, (
          <NewsSection
            key={`${appId}\n${url}`}
            appId={appId}
            url={url!}
            sources={sources}
            revision={revision} />
        ));

      let children = node.props.children;

      if (hasClass(classes.LeftColumn)) {
        const [notice, ...sections] = Array.isArray(children) ? children : [children];

        // Themes use the native non-Steam notice to position controls elsewhere.
        // Keep it hidden after the SeekTargets so it occupies no space or section index.
        children = [
          ...sections.map(section => visit(section, true)),
          <div key="external-shortcut-notice" hidden aria-hidden="true">{notice}</div>,
        ];
      } else {
        children = visit(children, inLeftColumn);
      }

      // Recreate columns only on structural changes, allowing one-time theme
      // discovery to run. URL/content updates retain the container's identity.
      const nextChildren = Array.isArray(children) ? children : [children];

      if (hasClass(classes.ColumnContainer))
        return cloneElement(node, {
          key: `${node.key || 'columns'}:${url ? 'with-external-news' : 'without-external-news'}`
        }, ...nextChildren);

      return children === node.props.children
        ? node
        : cloneElement(node, undefined, ...nextChildren);
    };
    
    return visit(tree);
  };
}
