import { Dropdown, Field } from 'millennium';
import { useEffect, useState } from 'react';
import { getPluginI18nString } from '../../i18n';
import { dateLocales } from '../../steam/client';
import { daysInMonth, MIN_RELEASE_YEAR, maxReleaseYear } from '../../release-date/calendar-date';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePropertyStyles } from '../../hooks/use-property-styles';
import type { ReleaseDateManager } from '../../release-date/manager';

interface ExternalReleaseDateProps {
  appId: string;
  manager: ReleaseDateManager;
}

export function ExternalReleaseDate({ appId, manager }: ExternalReleaseDateProps) {
  const [date, setDate] = useState<Date | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { busy, status, error, run } = useAsyncStatus();
  const { classes } = usePropertyStyles();

  useEffect(() => {
    let active = true;
    void run(async () => {
      await manager.load();
      if (active) {
        const saved = manager.dates[appId];
        setDate(saved ? new Date(saved.year, saved.month - 1, saved.day, 12) : null);
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [appId, manager, run]);

  const lastYear = maxReleaseYear();

  const selectedDate  = date || new Date();
  const selectedYear  = selectedDate.getFullYear();
  const selectedMonth = selectedDate.getMonth() + 1;
  const selectedDay   = selectedDate.getDate();

  const getEmptyOption = (padSize: number) => {
    return { data: 0, label: '-'.repeat(padSize) };
  };

  const years = [
    getEmptyOption(4),
    ...Array.from({ length: lastYear - MIN_RELEASE_YEAR + 1 }, (_, index) => lastYear - index)
      .map(data => ({ data, label: String(data) }))
  ];

  const monthFormatter = new Intl.DateTimeFormat(dateLocales(), { month: 'long' });

  const months = [
    getEmptyOption(8),
    ...Array.from({ length: 12 }, (_, index) => index + 1)
      .map(data => ({ data, label: monthFormatter.format(new Date(2000, data - 1, 1)) }))
  ];

  const days = [
    getEmptyOption(2),
    ...Array.from({ length: daysInMonth(selectedYear, selectedMonth) }, (_, index) => index + 1)
      .map(data => ({ data, label: String(data).padStart(2, '0') }))
  ];

  const select = (nextYear: number, nextMonth: number, nextDay = selectedDay) => {
    const nextDate = new Date(nextYear, nextMonth - 1, Math.min(nextDay, daysInMonth(nextYear, nextMonth)), 12);
    void run(async () => {
      await manager.set(appId, nextDate);
      setDate(nextDate);
    });
  };

  const clear = () => run(async () => {
    await manager.clear(appId);
    setDate(null);
  });

  return (
    <div className={classes?.SectionTopLine}>

      <div className={classes?.Title}>{getPluginI18nString('externalReleaseDate')}</div>

      <Field label={getPluginI18nString('releaseDate')} childrenContainerWidth="max" verticalAlignment="center">

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%', minWidth: 0 }}>

          <div style={{ width: 110 }}>
            <Dropdown menuLabel={getPluginI18nString('year')} rgOptions={years}
              selectedOption={date ? selectedYear : 0} disabled={busy || !loaded}
              contextMenuPositionOptions={{ bGrowToElementWidth: true }}
              onChange={option => option.data === 0 ? void clear() : select(option.data, selectedMonth)} />
          </div>

          <div style={{ width: 160 }}>
            <Dropdown menuLabel={getPluginI18nString('month')} rgOptions={months}
              selectedOption={date ? selectedMonth : 0} disabled={busy || !loaded}
              contextMenuPositionOptions={{ bGrowToElementWidth: true }}
              onChange={option => option.data === 0 ? void clear() : select(selectedYear, option.data)} />
          </div>

          <div style={{ width: 90 }}>
            <Dropdown menuLabel={getPluginI18nString('day')} rgOptions={days}
              selectedOption={date ? selectedDay : 0} disabled={busy || !loaded}
              contextMenuPositionOptions={{ bGrowToElementWidth: true }}
              onChange={option => option.data === 0 ? void clear() : select(selectedYear, selectedMonth, option.data)} />
          </div>

        </div>

      </Field>

      {error && <div role="alert" style={{ marginTop: 12 }}>{status}</div>}

    </div>
  );
}
