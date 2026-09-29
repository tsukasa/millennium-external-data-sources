import { cloneElement, isValidElement, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { isNonSteamId, type AppOverview } from './client';
import type { FeedManager } from '../feed/manager';

export interface LayoutClasses {
  LeftColumn: string;
  ColumnContainer: string;
}

export interface LayoutProps {
  overview: Pick<AppOverview, 'appid'>;
  parentComponent: SectionRegistrar;
  setSections: Set<string>;
}

export type LayoutRenderer = (props: LayoutProps) => ReactNode;

export interface SectionRegistrar {
  RegisterSection(name: string, element: HTMLElement | null): void;
}

export interface SeekTargetProps {
  name: string;
  parent: SectionRegistrar;
  children?: ReactNode;
}

interface LayoutElementProps {
  className?: string;
  name?: string;
  children?: ReactNode;
}

export type SeekTarget = ComponentType<SeekTargetProps>;

/**
 * Wraps Steam's library layout renderer to show external news for configured
 * non-Steam shortcuts in the activity section.
 * @param original Steam's original library layout renderer.
 * @param Seek Component used by Steam to register layout sections.
 * @param classes CSS class names for the library columns.
 * @param feedManager Feed configuration and change notifications.
 * @returns A renderer that adds the external news section when applicable.
 */
export function createLibraryLayout(original: LayoutRenderer, Seek: SeekTarget, classes: LayoutClasses, feedManager: FeedManager): LayoutRenderer {
  const subscribe = (notify: () => void) => feedManager.subscribe(notify);
  const snapshot = () => feedManager.revision;

  return function ExternalLibraryLayout(props) {
    useSyncExternalStore(subscribe, snapshot);
    const appId = String(props.overview.appid);
    const url = feedManager.values[appId];
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

      if (!isValidElement<LayoutElementProps>(node))
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
          key: `${node.key || 'columns'}:with-external-news`
        }, ...nextChildren);

      return children === node.props.children
        ? node
        : cloneElement(node, undefined, ...nextChildren);
    };

    return visit(tree);
  };
}
