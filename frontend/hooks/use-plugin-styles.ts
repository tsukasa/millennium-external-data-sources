import { useLayoutEffect, useRef } from 'react';
import { uiCss } from '../styles';

const documents = new WeakMap<Document, { style: HTMLStyleElement; users: number }>();

/** Share one stylesheet per Steam document; release it when the last editor unmounts. */
export function usePluginStyles() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const doc = ref.current?.ownerDocument;

    if (!doc)
      return;

    let entry = documents.get(doc);

    if (!entry) {
      const style = doc.createElement('style');
      style.dataset.extdatasrcPlugin = 'ui';
      style.textContent = uiCss;
      doc.head.append(style);
      entry = { style, users: 0 };
      documents.set(doc, entry);
    }

    entry.users++;

    return () => {
      if (--entry.users === 0) {
        entry.style.remove();
        documents.delete(doc);
      }
    };
  }, []);

  return ref;
}
