import {
  Button, DialogCheckbox, DialogControlsSection, DialogControlsSectionHeader, Dropdown, Field, TextField
} from 'millennium';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPluginI18nString } from '../../i18n';
import { dateLocales } from '../../steam/client';
import { findStoreTags, storeTagName } from '../../steam/store-tags';
import { daysInMonth, MIN_RELEASE_YEAR, maxReleaseYear, toCalendarDate } from '../../game-details/calendar-date';
import { useAsyncStatus } from '../../hooks/use-async-status';
import { usePluginStyles } from '../../hooks/use-plugin-styles';
import { StatusMessage } from './status-message';
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
  const year = selected.getFullYear();
  const month = selected.getMonth() + 1;
  const day = selected.getDate();
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
    <Field label={label} childrenContainerWidth="max" verticalAlignment="center" bottomSeparator="none">
      <div role="group" aria-label={label} className="extdatasrc-plugin-date-controls">
        <Dropdown menuLabel={`${label}: ${getPluginI18nString('year')}`} rgOptions={years}
          selectedOption={value ? year : 0} disabled={disabled}
          onChange={option => option.data === 0 ? onChange('') : select(option.data, month)} />
        <Dropdown menuLabel={`${label}: ${getPluginI18nString('month')}`} rgOptions={months}
          selectedOption={value ? month : 0} disabled={disabled}
          onChange={option => option.data === 0 ? onChange('') : select(year, option.data)} />
        <Dropdown menuLabel={`${label}: ${getPluginI18nString('day')}`} rgOptions={days}
          selectedOption={value ? day : 0} disabled={disabled}
          onChange={option => option.data === 0 ? onChange('') : select(year, month, option.data)} />
      </div>
    </Field>
  );
}

interface TokenListFieldProps<T extends StoreTag> {
  label: string;
  tokens: T[];
  draft: string;
  disabled: boolean;
  tokenLabel(token: T): string;
  tokenClassName?(token: T): string;
  onDraft(value: string): void;
  onAdd(): void;
  onRemove(token: T): void;
  onInputFocus?(input: HTMLInputElement): void;
  rememberFocus(input: HTMLInputElement): void;
  children?: ReactNode;
}

/**
 * A settings row with only a label and an input, continued by a row with the saved values.
 * Themes such as Adwaita render the input row as an entry row and stretch the input
 * over it, so the values need a row of their own. Enter adds the input.
 */
function TokenListField<T extends StoreTag>({ label, tokens, draft, disabled, tokenLabel, tokenClassName,
  onDraft, onAdd, onRemove, onInputFocus, rememberFocus, children }: TokenListFieldProps<T>) {
  return (
    <>
      <Field label={label} childrenLayout="below" bottomSeparator="none" className="extdatasrc-plugin-wide-input">
        <TextField aria-label={label} value={draft} disabled={disabled}
          onFocus={event => onInputFocus?.(event.currentTarget)}
          onChange={event => {
            onInputFocus?.(event.currentTarget);
            onDraft(event.target.value);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault();
              rememberFocus(event.currentTarget);
              onAdd();
            }
          }} />
      </Field>
      {children}
      {!!tokens.length && (
        // The description spans the row; themes such as Adwaita push field children to the right.
        <Field bottomSeparator="none" className="extdatasrc-plugin-field-continuation" description={
          <ul aria-label={label} className="extdatasrc-plugin-token-list">
            {tokens.map(token => (
              <li key={String(token)} className={`extdatasrc-plugin-token ${tokenClassName?.(token) || ''}`}>
                <span className="extdatasrc-plugin-token-label">{tokenLabel(token)}</span>
                <Button className="extdatasrc-plugin-token-remove" disabled={disabled}
                  aria-label={`${getPluginI18nString('clear')}: ${tokenLabel(token)}`}
                  onClick={() => onRemove(token)}>×</Button>
              </li>
            ))}
          </ul>
        } />
      )}
    </>
  );
}

interface CompanyNamesFieldProps {
  field: 'developer' | 'publisher';
  names: string[];
  draft: string;
  disabled: boolean;
  onDraft(value: string): void;
  onSave(names: string[]): void;
  rememberFocus(input: HTMLInputElement): void;
}

function CompanyNamesField({ field, names, draft, disabled, onDraft, onSave, rememberFocus }: CompanyNamesFieldProps) {
  const add = () => {
    const name = draft.trim();
    if (name)
      onSave([...names, name]);
  };

  return (
    <TokenListField label={getPluginI18nString(field)} tokens={names} draft={draft} disabled={disabled}
      tokenLabel={name => name} onDraft={onDraft} onAdd={add} rememberFocus={rememberFocus}
      onRemove={name => onSave(names.filter(value => value !== name))} />
  );
}

interface StoreTagsFieldProps {
  tags: StoreTag[];
  draft: string;
  disabled: boolean;
  onDraft(value: string): void;
  onSave(tags: StoreTag[], keepDraft?: boolean): void;
  rememberFocus(input: HTMLInputElement): void;
}

function StoreTagsField({ tags, draft, disabled, onDraft, onSave, rememberFocus }: StoreTagsFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect>();
  const suggestions = findStoreTags(draft).slice(0, 10);
  const win = input.current?.ownerDocument.defaultView;
  const spaceBelow = anchor ? (win?.innerHeight || 0) - anchor.bottom : 0;
  const openAbove = !!anchor && spaceBelow < Math.min(240, suggestions.length * 32 + 8) && anchor.top > spaceBelow;
  const label = getPluginI18nString('tags');

  useEffect(() => {
    if (!anchor)
      return;

    const field = input.current;
    const doc = field?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win)
      return;

    const closeOutside = (event: Event) => {
      if (event.target !== field && !popup.current?.contains(event.target as Node))
        setAnchor(undefined);
    };
    const reposition = () => setAnchor(field?.getBoundingClientRect());
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
    if (input.current)
      rememberFocus(input.current);
    onSave(checked ? [...tags, id] : tags.filter(value => value !== id), true);
  };

  const renderSuggestions = () => {
    const field = input.current;
    if (!anchor || !suggestions.length || !field)
      return null;

    return createPortal(
      <div ref={popup} role="group" aria-label={label} className="extdatasrc-plugin-tag-suggestions"
        style={{
          left: anchor.left, width: anchor.width,
          maxHeight: Math.max(48, Math.min(240, (openAbove ? anchor.top : spaceBelow) - 8)),
          ...(openAbove ? { bottom: (win?.innerHeight || 0) - anchor.top + 4 } : { top: anchor.bottom + 4 }),
        }}>
        {suggestions.map(tag => (
          <DialogCheckbox key={tag.id} label={tag.name} controlled bottomSeparator="none"
            checked={tags.includes(tag.id)} disabled={disabled}
            onChange={checked => toggleTag(tag.id, checked)} />
        ))}
      </div>, field.ownerDocument.body
    );
  };

  return (
    <TokenListField label={label} tokens={tags} draft={draft} disabled={disabled}
      tokenLabel={storeTagName}
      tokenClassName={tag => typeof tag === 'number' ? 'extdatasrc-plugin-token-store' : ''}
      onDraft={onDraft} onAdd={add} rememberFocus={rememberFocus}
      onRemove={tag => onSave(tags.filter(value => value !== tag))}
      onInputFocus={field => {
        input.current = field;
        setAnchor(field.getBoundingClientRect());
      }}>
      {renderSuggestions()}
    </TokenListField>
  );
}

export function ExternalGameDetails({ appId, manager }: ExternalGameDetailsProps) {
  const [details, setDetails] = useState<GameDetails>({});
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState({ developer: '', publisher: '', tags: '' });
  const { busy, status, error, run } = useAsyncStatus();
  const focusAfterSave = useRef<HTMLInputElement | null>(null);
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
    <div ref={styleRef} className="extdatasrc-plugin-group">
      <DialogControlsSection className="extdatasrc-plugin-section">
        <DialogControlsSectionHeader>{getPluginI18nString('externalGameDetails')}</DialogControlsSectionHeader>

        {(['releaseDate', 'addedToLibraryDate'] as const).map(field => (
          <DateField key={field} label={getPluginI18nString(field)} value={details[field]}
            disabled={disabled} onChange={value => save(field, value)} />
        ))}

        {(['developer', 'publisher'] as const).map(field => (
          <CompanyNamesField key={field} field={field} names={details[field] || []} draft={drafts[field]}
            disabled={disabled} rememberFocus={rememberFocus}
            onDraft={value => setDrafts(previous => ({ ...previous, [field]: value }))}
            onSave={names => save(field, names)} />
        ))}

        <StoreTagsField tags={details.tags || []} draft={drafts.tags} disabled={disabled}
          rememberFocus={rememberFocus}
          onDraft={value => setDrafts(previous => ({ ...previous, tags: value }))}
          onSave={(tags, keepDraft) => save('tags', tags, keepDraft)} />

        <StatusMessage status={error ? status : ''} error={error} />
      </DialogControlsSection>
    </div>
  );
}
