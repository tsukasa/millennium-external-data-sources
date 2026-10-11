import { Dropdown } from 'millennium';
import { getPluginI18nString } from '../../i18n';

export type ConfigurationSection = 'general' | 'feeds';

/** Class names of a section panel; inactive panels stay mounted but hidden. */
export function sectionPanelClassName(visible: boolean): string {
  return visible
    ? 'DialogBody extdatasrc-plugin-settings-panel'
    : 'DialogBody extdatasrc-plugin-settings-panel extdatasrc-plugin-settings-panel-hidden';
}

/** Section selector, similar to how Millennium's theme editor header works. */
interface ConfigurationSectionSelectorProps {
  section: ConfigurationSection;
  onChange(section: ConfigurationSection): void;
}

export function ConfigurationSectionSelector({ section, onChange }: ConfigurationSectionSelectorProps) {
  return (
    <div className="MillenniumDesktopSidebar_EditorHeader extdatasrc-plugin-settings-section-selector">
      <Dropdown
        rgOptions={[
          { data: 'general', label: getPluginI18nString('generalSettings') },
          { data: 'feeds', label: getPluginI18nString('feedSettingsSection') },
        ]}
        selectedOption={section}
        contextMenuPositionOptions={{ bMatchWidth: true }}
        onChange={option => onChange(option.data as ConfigurationSection)} />
    </div>
  );
}
