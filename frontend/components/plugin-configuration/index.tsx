import { useState } from 'react';
import type { FeedManager } from '../../feed/manager';
import { ConfigurationSectionSelector, type ConfigurationSection } from './section-selector';
import { PluginConfigurationGeneral } from './general';
import { PluginConfigurationFeed } from './feeds';

interface PluginConfigurationProps {
  feedManager: FeedManager;
}

/** Millennium plugin settings, grouped by configuration section. */
export function PluginConfiguration({ feedManager }: PluginConfigurationProps) {
  const [section, setSection] = useState<ConfigurationSection>('general');

  return (
    <div>
      <ConfigurationSectionSelector section={section} onChange={setSection} />

      <div className="MillenniumDesktopSidebar_EditorContent">
        <PluginConfigurationGeneral visible={section === 'general'} />
        <PluginConfigurationFeed feedManager={feedManager} visible={section === 'feeds'} />
      </div>
    </div>
  );
}
