import { useNativeControls, type NumericOption } from '../../hooks/use-native-controls';
import { TextField } from 'millennium';
import { useCallback, useEffect, useState } from 'react';
import { httpUrl } from '../../feed';
import { getPluginI18nString } from '../../i18n';
import { EXTERNAL_NEWS_DEFAULT_MAX_ITEMS, EXTERNAL_NEWS_MAX_ITEMS } from '../../constants';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePropertyStyles } from '../../hooks/use-property-styles';
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

  const { ToggleRow, DropdownRow } = useNativeControls();

  const itemOptions = Array.from({ length: EXTERNAL_NEWS_MAX_ITEMS + 1 }, (_, data) => data).map(data => ({
    data, label: data === 0 ? getPluginI18nString('maxItemsUnlimited') : String(data),
  }));

  const reset = useCallback(() => {
    setValue(manager.values[appId] || '');
    setShowInWhatsNew(manager.showFeedInWhatsNew[appId] !== false);
    setMaxItems(manager.maxItemsFromFeedInWhatsNew[appId] ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS);
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
    <div>
      <div className={classes?.Title}>{getPluginI18nString('externalNewsSource')}</div>

      {/* Feed URL */}
      <div>{getPluginI18nString('chooseFeed')}</div>
      <div className={classes?.AsyncBackedInputChildren}>
        <TextField
          value={value}
          disabled={busy || !loaded}
          onChange={event => setValue(event.target.value)} />

        <button type="button" className={buttonClass}
          disabled={busy || !loaded || !httpUrl(value.trim())}
          onClick={save}>{getPluginI18nString('save')}</button>

        <button type="button" className={buttonClass}
          disabled={busy || !loaded || !manager.values[appId]}
          onClick={clear}>{getPluginI18nString('clear')}</button>
      </div>

      {/* Show in What's New */}
      <div className="DialogControlsSection" style={{ width: '100%', boxSizing: 'border-box' }}>
        <ToggleRow label={getPluginI18nString('showFeedInWhatsNew')}
          checked={showInWhatsNew} disabled={busy || !loaded} onChange={toggleWhatsNew} />
      </div>

      <div className="DialogControlsSection" style={{ width: '100%', boxSizing: 'border-box' }}>
        <DropdownRow label={getPluginI18nString('maxItemsInWhatsNewTitle')}
          description={getPluginI18nString('maxItemsInWhatsNewDescription')}
          rgOptions={itemOptions} selectedOption={maxItems} disabled={busy || !loaded}
          contextMenuPositionOptions={{ bMatchWidth: false }} onChange={changeMaxItems} />
      </div>

      {/* Status Message */}
      <div role={error ? 'alert' : 'status'} style={{ marginTop: 12 }}>{status}</div>

    </div>
  );
}
