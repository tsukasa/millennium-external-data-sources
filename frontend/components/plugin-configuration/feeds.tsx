import { Field, TextField } from 'millennium';
import { useEffect, useState } from 'react';
import { getPluginI18nString } from '../../i18n';
import { FeedManager } from '../../feed/manager';
import { useAsyncStatus } from '../../hooks/use-async-status';
import {
  EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL, EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES,
  EXTERNAL_NEWS_MIN_FETCH_INTERVAL, EXTERNAL_NEWS_MAX_FETCH_INTERVAL,
  EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES, EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES,
} from '../../constants';

interface PluginConfigurationFeedProps {
  feedManager: FeedManager;
  visible: boolean;
}

/** Global feed controls shown in Millennium's plugin configuration. */
export function PluginConfigurationFeed({ feedManager, visible }: PluginConfigurationFeedProps) {
  const [interval, setIntervalValue] = useState(String(EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL));
  const [concurrency, setConcurrency] = useState(String(EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES));
  const { busy, status, error, run } = useAsyncStatus();

  useEffect(() => {
    let active = true;

    void run(async () => {
      await feedManager.load();

      if (active) {
        setIntervalValue(String(feedManager.refreshIntervalMinutes));
        setConcurrency(String(feedManager.concurrentFetches));
      }
    });

    return () => {
      active = false;
    };
  }, [feedManager, run]);

  const minutes = Number(interval);
  const count = Number(concurrency);

  const inputPassedValidation = FeedManager.isValidGlobalFeedIntervalValue(minutes) && FeedManager.isValidGlobalFeedConcurrencyValue(count);

  const save = () => {
    if (!inputPassedValidation)
      return;

    return run(() => feedManager.setPluginFeedSettings(minutes, count), 'saving', 'feedSettingsSaved');
  };

  return (
    <div className="DialogBody" style={{ width: '100%', display: visible ? undefined : 'none' }}>

      {/* Feed Refresh Interval */}

      <Field label={getPluginI18nString('refreshIntervalMinutes')}
        description={getPluginI18nString('refreshIntervalDescription')}
        childrenContainerWidth="fixed"
        verticalAlignment="center"
        padding="standard"
        bottomSeparator="standard"
        highlightOnFocus>

        <TextField aria-label={getPluginI18nString('refreshIntervalMinutes')}
          mustBeNumeric
          rangeMin={EXTERNAL_NEWS_MIN_FETCH_INTERVAL}
          rangeMax={EXTERNAL_NEWS_MAX_FETCH_INTERVAL}
          value={interval}
          disabled={busy}
          onChange={event => setIntervalValue(event.target.value)}
          style={{ width: 44 }} />
      </Field>

      {/* Simultaneous Feed Fetches */}

      <Field label={getPluginI18nString('concurrentFeedFetches')}
        description={getPluginI18nString('concurrentFeedFetchesDescription')}
        childrenContainerWidth="fixed"
        verticalAlignment="center"
        padding="standard"
        bottomSeparator="standard"
        highlightOnFocus>

        <TextField aria-label={getPluginI18nString('concurrentFeedFetches')}
          mustBeNumeric
          rangeMin={EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES}
          rangeMax={EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES}
          value={concurrency}
          disabled={busy}
          onChange={event => setConcurrency(event.target.value)}
          style={{ width: 24 }} />
      </Field>

      {/* Save Button */}

      <button type="button"
        className="DialogButton"
        disabled={busy || !inputPassedValidation}
        onClick={save}
        style={{ marginTop: 12 }}>
        {getPluginI18nString('save')}
      </button>

      <div role={error ? 'alert' : 'status'} style={{ marginTop: 12 }}>
        {status}
      </div>

    </div>
  );
}
