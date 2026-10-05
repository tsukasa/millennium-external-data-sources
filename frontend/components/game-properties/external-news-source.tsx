import { useNativeControls, type NumericOption } from '../../hooks/use-native-controls';
import { Button, TextField } from 'millennium';
import { useCallback, useEffect, useState } from 'react';
import { httpUrl } from '../../feed';
import { getPluginI18nString } from '../../i18n';
import { EXTERNAL_NEWS_DEFAULT_MAX_ITEMS, EXTERNAL_NEWS_MAX_ITEMS } from '../../constants';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePropertyStyles } from '../../hooks/use-property-styles';
import { usePluginStyles } from '../../hooks/use-plugin-styles';
import type { FeedManager } from '../../feed/manager';

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
  const { classes, buttonClass } = usePropertyStyles();
  const styleRef = usePluginStyles();

  const { ToggleRow, DropdownRow } = useNativeControls();

  const itemOptions = Array.from({ length: EXTERNAL_NEWS_MAX_ITEMS + 1 }, (_, data) => data).map(data => ({
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

  const save = () => run(async () => {
    await manager.save(appId, value);
    reset();
  }, 'saving', 'feedSettingsSaved');

  const clear = () => run(async () => {
    await manager.clear(appId);
    reset();
  }, 'clearing', 'feedSettingsCleared');

  const toggleWhatsNew = (checked: boolean) => run(async () => {
    await manager.setShowFeedInWhatsNew(appId, checked);
    setShowInWhatsNew(checked);
  }, 'saving', 'feedSettingsSaved');

  const changeMaxItems = (option: NumericOption) => run(async () => {
    await manager.setMaxItemsFromFeedInWhatsNew(appId, option.data);
    setMaxItems(option.data);
  }, 'saving', 'feedSettingsSaved');

  return (
    <>
      <div ref={styleRef} className={`${classes?.SectionTopLine || ''} SectionTopLine extdatasrc-plugin-news-source-header`}>

        <div className={`${classes?.Title || ''} Title`}>{getPluginI18nString('externalNewsSource')}</div>

        {/* Feed URL */}
        <div className="DialogBodyText">{getPluginI18nString('chooseFeed')}</div>

        <div className={`${classes?.AsyncBackedInputChildren || ''} AsyncBackedInputChildren`}>

          <TextField
            value={value}
            disabled={busy || !loaded}
            onChange={event => setValue(event.target.value)} />

          <Button className={buttonClass}
            disabled={busy || !loaded || !httpUrl(value.trim())}
            onClick={save}>{getPluginI18nString('save')}</Button>

          <Button className={buttonClass}
            disabled={busy || !loaded || !manager.sources[appId]?.url}
            onClick={clear}>{getPluginI18nString('clear')}</Button>

        </div>

      </div>

      {/* Show in What's New */}
      <div className="DialogControlsSection extdatasrc-plugin-news-source-controls">

        <ToggleRow label={getPluginI18nString('showFeedInWhatsNew')}
          checked={showInWhatsNew} disabled={busy || !loaded} onChange={toggleWhatsNew} />

        <DropdownRow label={getPluginI18nString('maxItemsInWhatsNewTitle')}
          description={getPluginI18nString('maxItemsInWhatsNewDescription')}
          rgOptions={itemOptions} selectedOption={maxItems} disabled={busy || !loaded}
          contextMenuPositionOptions={{ bMatchWidth: false }} onChange={changeMaxItems} />

      </div>

      {/* Status Message */}
      {status && <div role={error ? 'alert' : 'status'} className="extdatasrc-plugin-form-status-message">{status}</div>}

    </>
  );
}
