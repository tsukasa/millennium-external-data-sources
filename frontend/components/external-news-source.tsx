import { findClassModule, TextField } from 'millennium';
import { useEffect, useState } from 'react';
import { httpUrl } from '../feed';
import { getPluginI18nString } from '../i18n';
import type { Sources } from '../sources';

export function ExternalNewsSource({ appId, sources }: { appId: string; sources: Sources }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState(getPluginI18nString('loading'));
  const [error, setError] = useState(false);
  const classes = findClassModule(m => m.SectionTopLine) as Record<string, string> | undefined;
  const steamButtons = findClassModule(m => m.DialogButton && m.Focusable) as Record<string, string> | undefined;

  const buttonClass = [
    steamButtons?.DialogButton || '_1KAp5PPYG7si-T_66zNEcU',
    steamButtons?.Focusable || '_2MgqWIMDzJajWDw345eImx',
    'DialogButton',
    'Focusable'
  ].join(' ');

  useEffect(() => {
    let active = true;

    sources
      .load()
      .then(() => {
        if (active) {
          setValue(sources.values[appId] || '');  
          setLoaded(true); setStatus('');
        }
      })
      .catch(reason => {
        if (active) {
          setError(true);
          setStatus(String(reason));
        }
      })
      .finally(() => {
        if (active)
          setBusy(false);
        }
      );

    return () => {
      active = false;
    };
  }, [appId, sources]);

  const change = async (clear: boolean) => {
    setBusy(true);
    setError(false);
    setStatus(clear ? getPluginI18nString('clearing') : getPluginI18nString('saving'));
    
    try {
      if (clear) {
        await sources.clear(appId);
      } else {
        await sources.save(appId, value);
      }

      setValue(sources.values[appId] || '');
      setStatus(clear ? getPluginI18nString('feedSettingsCleared') : getPluginI18nString('feedSettingsSaved'));
    } catch (reason) {
      setError(true);
      setStatus(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={classes?.Title}>{getPluginI18nString('externalNewsSource')}</div>
      <div>{getPluginI18nString('chooseFeed')}</div>
      <div className={classes?.AsyncBackedInputChildren}>
        <TextField
          value={value}
          disabled={busy || !loaded}
          onChange={event => setValue(event.target.value)} />
        <button type="button" className={buttonClass}
          disabled={busy || !loaded || !httpUrl(value.trim())}
          onClick={() => change(false)}>{getPluginI18nString('save')}</button>
        <button type="button" className={buttonClass}
          disabled={busy || !loaded || !sources.values[appId]}
          onClick={() => change(true)}>{getPluginI18nString('clear')}</button>
      </div>
    
      <div role={error ? 'alert' : 'status'} style={{ marginTop: 12 }}>{status}</div>

    </div>
  );
}
