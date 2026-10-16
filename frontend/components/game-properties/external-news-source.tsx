import { DialogControlsSection, DialogControlsSectionHeader, DropdownItem, Field, TextField, Toggle } from 'millennium';
import { useCallback, useEffect, useRef, useState } from 'react';
import { httpUrl } from '../../feed';
import { getPluginI18nString } from '../../i18n';
import { EXTERNAL_NEWS_DEFAULT_MAX_ITEMS, EXTERNAL_NEWS_MAX_ITEMS } from '../../constants';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePluginStyles } from '../../hooks/use-plugin-styles';
import { StatusMessage } from './status-message';
import type { FeedManager } from '../../feed/manager';

/** Delay after the last keystroke before a valid feed URL is saved. */
const FEED_URL_SAVE_DELAY_MS = 750;

/**
 * Empty input clears the feed. Steam's `mustBeURL` would reject it, and hosts
 * without a TLD such as localhost; its messages also only render for a labeled TextField.
 */
const validateFeedUrl = (value: string) =>
  value.trim() && !httpUrl(value.trim()) ? getPluginI18nString('enterFeedUrl') : null;

interface ExternalNewsSourceProps {
  appId: string;
  manager: FeedManager;
}

export function ExternalNewsSource({ appId, manager }: ExternalNewsSourceProps) {
  const [value, setValue] = useState('');
  const [showInWhatsNew, setShowInWhatsNew] = useState(true);
  const [maxItems, setMaxItems] = useState(EXTERNAL_NEWS_DEFAULT_MAX_ITEMS);
  const [loaded, setLoaded] = useState(false);
  const { busy, status, error, run } = useAsyncStatus('loading');
  const styleRef = usePluginStyles();
  const disabled = busy || !loaded;

  const itemOptions = Array.from({ length: EXTERNAL_NEWS_MAX_ITEMS + 1 }, (_, data) => ({
    data, label: data === 0 ? getPluginI18nString('maxItemsUnlimited') : String(data),
  }));

  const reset = useCallback(() => {
    setValue(manager.sources[appId]?.url || '');
    setShowInWhatsNew(manager.sources[appId]?.showFeedInWhatsNew !== false);
    setMaxItems(manager.sources[appId]?.maxItemsFromFeedInWhatsNew ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS);
  }, [appId, manager]);

  useEffect(() => {
    let active = true;

    void run(async () => {
      await manager.load();

      if (active) {
        reset();
        setLoaded(true);
      }
    }, 'loading');

    return () => {
      active = false;
    };
  }, [manager, reset, run]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingUrl = useRef<string>(undefined);
  const urlWrites = useRef(Promise.resolve());

  /** Saves a valid URL or clears the feed for an empty value; writes run in input order. */
  const commitUrl = useCallback(() => {
    clearTimeout(saveTimer.current);
    const input = pendingUrl.current;
    pendingUrl.current = undefined;

    if (input === undefined || validateFeedUrl(input))
      return;

    urlWrites.current = urlWrites.current.then(() => {
      const url = input.trim() ? httpUrl(input.trim()) : '';

      if (url === (manager.sources[appId]?.url || ''))
        return;

      return url
        ? run(() => manager.save(appId, url), 'saving', 'feedSettingsSaved')
        : run(async () => {
          await manager.clear(appId);
          // Clearing drops the options too; the next save uses the defaults shown here.
          setShowInWhatsNew(true);
          setMaxItems(EXTERNAL_NEWS_DEFAULT_MAX_ITEMS);
        }, 'clearing', 'feedSettingsCleared');
    });
  }, [appId, manager, run]);

  // Closing the dialog saves a URL that is still waiting for the delay.
  useEffect(() => commitUrl, [commitUrl]);

  const changeUrl = (input: string) => {
    setValue(input);
    pendingUrl.current = input;
    clearTimeout(saveTimer.current);

    // The clear action empties the field at once; typed URLs wait for a pause.
    if (input)
      saveTimer.current = setTimeout(commitUrl, FEED_URL_SAVE_DELAY_MS);
    else
      commitUrl();
  };

  const toggleWhatsNew = (checked: boolean) => run(async () => {
    await manager.setShowFeedInWhatsNew(appId, checked);
    setShowInWhatsNew(checked);
  }, 'saving', 'feedSettingsSaved');

  const changeMaxItems = (data: number) => run(async () => {
    await manager.setMaxItemsFromFeedInWhatsNew(appId, data);
    setMaxItems(data);
  }, 'saving', 'feedSettingsSaved');

  const urlError = validateFeedUrl(value);

  return (
    <div ref={styleRef} className="extdatasrc-plugin-group">
      <DialogControlsSection className="extdatasrc-plugin-section">
        <DialogControlsSectionHeader>{getPluginI18nString('externalNewsSource')}</DialogControlsSectionHeader>

        {/* Only label and input inside the row: themes such as Adwaita stretch the input over it. */}
        <Field label={getPluginI18nString('feedUrl')} childrenLayout="below" bottomSeparator="none"
          className="extdatasrc-plugin-wide-input">
          {/* Saving must not disable the field, or typing would lose focus. */}
          <TextField aria-label={getPluginI18nString('feedUrl')} value={value} disabled={!loaded} bShowClearAction
            onChange={event => changeUrl(event.target.value)} onBlur={commitUrl} />
        </Field>
        {/* A row of its own continues the input row on the theme's row background. */}
        {urlError && (
          <Field bottomSeparator="none" className="extdatasrc-plugin-field-continuation"
            description={<span role="alert" className="extdatasrc-plugin-field-error">{urlError}</span>} />
        )}

        {/* ToggleField renders the gamepad variant here; desktop pages pair Field with Toggle. */}
        <Field label={getPluginI18nString('showFeedInWhatsNew')} bottomSeparator="none">
          <Toggle value={showInWhatsNew} disabled={disabled} onChange={toggleWhatsNew} />
        </Field>

        <DropdownItem label={getPluginI18nString('maxItemsInWhatsNewTitle')}
          description={getPluginI18nString('maxItemsInWhatsNewDescription')}
          rgOptions={itemOptions} selectedOption={maxItems} disabled={disabled}
          onChange={option => changeMaxItems(option.data)} />

        <StatusMessage status={status} error={error} />
      </DialogControlsSection>
    </div>
  );
}
