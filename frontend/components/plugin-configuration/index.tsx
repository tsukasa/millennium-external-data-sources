import { useState } from 'react';
import type { FeedManager } from '../../feed/manager';
import { ConfigurationSectionSelector, sectionPanelClassName, type ConfigurationSection } from './section-selector';
import { getPluginI18nString } from '../../i18n';
import { PluginConfigurationFeed } from './feeds';
import { usePluginStyles } from '../../hooks/use-plugin-styles';

interface PluginConfigurationProps {
  feedManager: FeedManager;
}

/** Millennium plugin settings, grouped by configuration section. */
export function PluginConfiguration({ feedManager }: PluginConfigurationProps) {
  const [section, setSection] = useState<ConfigurationSection>('general');
  const styleRef = usePluginStyles();

  return (
    <div ref={styleRef} className="extdatasrc-plugin-settings">
      <ConfigurationSectionSelector section={section} onChange={setSection} />

      <div className="MillenniumDesktopSidebar_EditorContent extdatasrc-plugin-settings-content">
        <div className={sectionPanelClassName(section === 'general')}>
          {getPluginI18nString('configureFeedHint')}
        </div>
        <PluginConfigurationFeed feedManager={feedManager} visible={section === 'feeds'} />
      </div>
    </div>
  );
}
