import { Button, DialogCheckbox, DialogControlsSection, Dropdown, Field, TextField, findClassModule } from 'millennium';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPluginI18nString } from '../../i18n';
import { dateLocales } from '../../steam/client';
import { findStoreTags, storeTagName } from '../../steam/store-tags';
import { daysInMonth, MIN_RELEASE_YEAR, maxReleaseYear, toCalendarDate } from '../../game-details/calendar-date';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePropertyStyles } from '../../hooks/use-property-styles';
import { usePluginStyles } from '../../hooks/use-plugin-styles';
import type { PropertyStyles } from '../../hooks/use-property-styles';
import type { StoreTag } from '../../steam/store-tags';
import type { GameDetailsManager, GameDetails, GameDetailField } from '../../game-details/manager';

interface DateFieldProps {
  label: string;
  value?: string;
  disabled: boolean;
  onChange(value: string): void;
}

interface ExternalGameDetailsProps {
  appId: string;
  manager: GameDetailsManager;
}

function DateField({ label, value, disabled, onChange }: DateFieldProps) {
  const parts = value?.split('-').map(Number);
  const selected = parts ? new Date(parts[0], parts[1] - 1, parts[2], 12) : new Date();
  const year = selected.getFullYear(), month = selected.getMonth() + 1, day = selected.getDate();
  const lastYear = maxReleaseYear();
  const formatter = new Intl.DateTimeFormat(dateLocales(), { month: 'long' });

  const years = [{ data: 0, label: '----' },
    ...Array.from({ length: lastYear - MIN_RELEASE_YEAR + 1 }, (_, index) => {
      const data = lastYear - index;
      return { data, label: String(data) };
    })];

  const months = [{ data: 0, label: '--------' },
    ...Array.from({ length: 12 }, (_, index) => ({
      data: index + 1,
      label: formatter.format(new Date(2000, index, 1))
    }))];

  const days = [{ data: 0, label: '--' },
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) => ({
      data: index + 1,
      label: String(index + 1).padStart(2, '0')
    }))];

  const select = (nextYear: number, nextMonth: number, nextDay = day) =>
    onChange(toCalendarDate(new Date(
      nextYear,
      nextMonth - 1,
      Math.min(nextDay, daysInMonth(nextYear, nextMonth)),
      12
    )));

  return (
    <Field label={label} childrenContainerWidth="fixed" verticalAlignment="center">

      <div role="group" aria-label={label} className="extdatasrc-plugin-game-details-date-controls">

        <div className="extdatasrc-plugin-game-details-date-year">
          <Dropdown menuLabel={`${label}: ${getPluginI18nString('year')}`} rgOptions={years}
            selectedOption={value ? year : 0} disabled={disabled}
            contextMenuPositionOptions={{ bGrowToElementWidth: true }}
            onChange={option => option.data === 0 ? onChange('') : select(option.data, month)} />
        </div>

        <div className="extdatasrc-plugin-game-details-date-month">
          <Dropdown menuLabel={`${label}: ${getPluginI18nString('month')}`} rgOptions={months}
            selectedOption={value ? month : 0} disabled={disabled}
            contextMenuPositionOptions={{ bGrowToElementWidth: true }}
            onChange={option => option.data === 0 ? onChange('') : select(year, option.data)} />
        </div>

        <div className="extdatasrc-plugin-game-details-date-day">
          <Dropdown menuLabel={`${label}: ${getPluginI18nString('day')}`} rgOptions={days}
            selectedOption={value ? day : 0} disabled={disabled}
            contextMenuPositionOptions={{ bGrowToElementWidth: true }}
            onChange={option => option.data === 0 ? onChange('') : select(year, month, option.data)} />
        </div>

      </div>

    </Field>
  );
}

function ListField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="extdatasrc-plugin-game-details-list-editor">
      {/* Some themes turn Field inputs into full-row editors; keep the native surface separate. */}
      <div className="extdatasrc-plugin-game-details-list-editor-background" aria-hidden="true">
        <Field label={<span className="extdatasrc-plugin-game-details-list-editor-label">{label}</span>} />
      </div>
      <div className="extdatasrc-plugin-game-details-list-editor-content">
        {children}
      </div>
    </div>
  );
}

interface CompanyNamesFieldProps extends PropertyStyles {
  field: 'developer' | 'publisher';
  names: string[];
  draft: string;
  disabled: boolean;
  onDraft(value: string): void;
  onSave(names: string[]): void;
  rememberFocus(input: HTMLInputElement): void;
}

function CompanyNamesField({ field, names, draft, disabled, classes, buttonClass,
  onDraft, onSave, rememberFocus }: CompanyNamesFieldProps) {
  const label = getPluginI18nString(field);
  const add = () => {
    const name = draft.trim();
    if (name)
      onSave([...names, name]);
  };

  return (
    <ListField label={label}>
      <div className={`${classes?.AsyncBackedInputChildren || ''} AsyncBackedInputChildren`}>
        <div className="extdatasrc-plugin-game-details-list-editor-input">
          <TextField aria-label={label} value={draft} disabled={disabled}
            onChange={event => onDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && draft.trim()) {
                event.preventDefault();
                rememberFocus(event.currentTarget);
                add();
              }
            }} />
        </div>
        <Button className={buttonClass} aria-label={'+ ' + label}
          disabled={disabled || !draft.trim()} onClick={add}>+</Button>
      </div>
      {!!names.length && (
        <ul aria-label={label} className="extdatasrc-plugin-game-details-saved-entry-list">
          {names.map(name => (
            <li key={name} className="displayRow alignItemsCenter extdatasrc-plugin-game-details-company-row">
              <span className="extdatasrc-plugin-game-details-entry-label">{name}</span>
              <Button className={`${buttonClass} extdatasrc-plugin-game-details-company-remove-button`}
                aria-label={getPluginI18nString('clear') + ': ' + name} disabled={disabled}
                onClick={() => onSave(names.filter(value => value !== name))}>×</Button>
            </li>
          ))}
        </ul>
      )}
    </ListField>
  );
}

interface StoreTagsFieldProps extends PropertyStyles {
  tags: StoreTag[];
  draft: string;
  disabled: boolean;
  onDraft(value: string): void;
  onSave(tags: StoreTag[], keepDraft?: boolean): void;
  rememberFocus(input: HTMLInputElement): void;
}

function StoreTagsField({ tags, draft, disabled, classes, buttonClass,
  onDraft, onSave, rememberFocus }: StoreTagsFieldProps) {
  const inputContainer = useRef<HTMLDivElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect>();
  const filterClasses = useMemo(() => findClassModule(value => value.SearchResultsBox
    && value.FilterBucketBoxes && value.Checkbox) as Record<string, string> | undefined, []);
  const suggestions = findStoreTags(draft).slice(0, 10);
  const win = inputContainer.current?.ownerDocument.defaultView;
  const spaceBelow = anchor ? (win?.innerHeight || 0) - anchor.bottom : 0;
  const openAbove = !!anchor && spaceBelow < Math.min(240, suggestions.length * 21 + 8) && anchor.top > spaceBelow;
  const label = getPluginI18nString('tags');

  useEffect(() => {
    if (!anchor)
      return;

    const container = inputContainer.current;
    const doc = container?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win)
      return;

    const closeOutside = (event: Event) => {
      if (!container?.contains(event.target as Node) && !popup.current?.contains(event.target as Node))
        setAnchor(undefined);
    };
    const reposition = () => {
      const input = container?.querySelector('input');
      if (input)
        setAnchor(input.getBoundingClientRect());
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        setAnchor(undefined);
    };
    const controller = new win.AbortController();
    const options = { signal: controller.signal };
    doc.addEventListener('pointerdown', closeOutside, options);
    doc.addEventListener('focusin', closeOutside, options);
    doc.addEventListener('keydown', escape, options);
    win.addEventListener('resize', reposition, options);
    doc.addEventListener('scroll', reposition, { ...options, capture: true });
    return () => controller.abort();
  }, [anchor]);

  const add = () => {
    const names = draft.split(',').map(value => value.trim()).filter(Boolean);
    if (!names.length)
      return;
    const added = names.map(name => findStoreTags(name)
      .find(tag => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.id ?? name);
    onSave([...tags, ...added]);
  };

  const toggleTag = (id: number, checked: boolean) => {
    const input = inputContainer.current?.querySelector('input');
    if (input)
      rememberFocus(input);
    onSave(checked ? [...tags, id] : tags.filter(value => value !== id), true);
  };

  const renderSuggestions = () => {
    const container = inputContainer.current;
    if (!anchor || !suggestions.length || !container)
      return null;

    return createPortal(
      <div ref={popup} className={`extdatasrc-plugin-game-details-tag-suggestions-popup ${filterClasses?.Container || ''}`}
        style={{ left: anchor.left, width: anchor.width,
          ...(openAbove ? { bottom: (win?.innerHeight || 0) - anchor.top } : { top: anchor.bottom }) }}>
        <div className={`${filterClasses?.FilterBucket || ''} ${filterClasses?.SearchResultsBox || ''}`}>
          <div role="group" aria-label={label}
            className={`extdatasrc-plugin-game-details-tag-suggestions-list ${filterClasses?.FilterBucketBoxes || ''}`}
            style={{ maxHeight: Math.max(24, Math.min(240, (openAbove ? anchor.top : spaceBelow) - 8)) }}>
            {suggestions.map(tag => (
              <div key={tag.id} className={`${filterClasses?.Row || ''} ${filterClasses?.NotMoving || ''}`}>
                <DialogCheckbox className={filterClasses?.Checkbox} label={tag.name} controlled
                  checked={tags.includes(tag.id)} disabled={disabled}
                  onChange={checked => toggleTag(tag.id, checked)} />
              </div>
            ))}
          </div>
        </div>
      </div>, container.ownerDocument.body
    );
  };

  return (
    <ListField label={label}>
      <div className={`${classes?.AsyncBackedInputChildren || ''} AsyncBackedInputChildren`}>
        <div ref={inputContainer} className="extdatasrc-plugin-game-details-list-editor-input">
          <TextField aria-label={label} value={draft} disabled={disabled}
            onFocus={event => setAnchor(event.currentTarget.getBoundingClientRect())}
            onChange={event => {
              setAnchor(event.currentTarget.getBoundingClientRect());
              onDraft(event.target.value);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && draft.trim()) {
                event.preventDefault();
                rememberFocus(event.currentTarget);
                add();
              }
            }} />
          {renderSuggestions()}
        </div>
        <Button className={buttonClass} aria-label={'+ ' + label}
          disabled={disabled || !draft.trim()} onClick={add}>+</Button>
      </div>
      {!!tags.length && (
        <ul aria-label={label} className="extdatasrc-plugin-game-details-saved-entry-list extdatasrc-plugin-game-details-tag-chip-list">
          {tags.map(tag => (
            <li key={tag} className={`displayRow alignItemsCenter extdatasrc-plugin-game-details-tag-chip${typeof tag === 'number'
              ? ` ${filterClasses?.FilterStoreTag || ''} ${filterClasses?.Selected || ''}` : ' extdatasrc-plugin-game-details-custom-tag-chip'}`}>
              <span className="extdatasrc-plugin-game-details-entry-label">{storeTagName(tag)}</span>
              <Button className="Focusable extdatasrc-plugin-game-details-tag-remove-button"
                aria-label={getPluginI18nString('clear') + ': ' + storeTagName(tag)} disabled={disabled}
                onClick={() => onSave(tags.filter(value => value !== tag))}>×</Button>
            </li>
          ))}
        </ul>
      )}
    </ListField>
  );
}

export function ExternalGameDetails({ appId, manager }: ExternalGameDetailsProps) {
  const [details, setDetails] = useState<GameDetails>({});
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState({ developer: '', publisher: '', tags: '' });
  const { busy, status, error, run } = useAsyncStatus();
  const focusAfterSave = useRef<HTMLInputElement | null>(null);
  const styles = usePropertyStyles();
  const styleRef = usePluginStyles();
  const disabled = busy || !loaded;
  const rememberFocus = (input: HTMLInputElement) => { focusAfterSave.current = input; };

  useEffect(() => {
    if (!busy) {
      const input = focusAfterSave.current;
      focusAfterSave.current = null;
      if (input?.isConnected)
        input.focus();
    }
  });

  useEffect(() => {
    let active = true;
    void run(async () => {
      await manager.load();
      if (active) {
        setDetails(manager.details[appId] || {});
        setDrafts({ developer: '', publisher: '', tags: '' });
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [appId, manager, run]);

  const save = <K extends GameDetailField,>(field: K, value: NonNullable<GameDetails[K]>, keepDraft = false) => {
    if (JSON.stringify(value) === JSON.stringify(manager.details[appId]?.[field] || ''))
      return;

    void run(async () => {
      await manager.set(appId, field, value);
      setDetails(previous => ({ ...previous, [field]: manager.details[appId]?.[field] }));
      if (!keepDraft && (field === 'developer' || field === 'publisher' || field === 'tags'))
        setDrafts(previous => ({ ...previous, [field]: '' }));
    });
  };

  return (
    <>
      <div ref={styleRef} className={`${styles.classes?.SectionTopLine || ''} SectionTopLine extdatasrc-plugin-game-details-header`}>
        <div className={`${styles.classes?.Title || ''} Title`} role="heading" aria-level={3}>
          {getPluginI18nString('externalGameDetails')}
        </div>
      </div>
      <DialogControlsSection className="extdatasrc-plugin-game-details-date-section">
        {(['releaseDate', 'addedToLibraryDate'] as const).map(field => (
          <DateField key={field} label={getPluginI18nString(field)} value={details[field]}
            disabled={disabled} onChange={value => save(field, value)} />
        ))}
      </DialogControlsSection>
      {(['developer', 'publisher'] as const).map(field => (
        <CompanyNamesField key={field} field={field} names={details[field] || []} draft={drafts[field]}
          disabled={disabled} {...styles} rememberFocus={rememberFocus}
          onDraft={value => setDrafts(previous => ({ ...previous, [field]: value }))}
          onSave={names => save(field, names)} />
      ))}
      <StoreTagsField tags={details.tags || []} draft={drafts.tags} disabled={disabled}
        {...styles} rememberFocus={rememberFocus}
        onDraft={value => setDrafts(previous => ({ ...previous, tags: value }))}
        onSave={(tags, keepDraft) => save('tags', tags, keepDraft)} />
      {error && <div role="alert" className="extdatasrc-plugin-form-status-message">{status}</div>}
    </>
  );
}
