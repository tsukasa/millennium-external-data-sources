import { getPluginI18nString } from '../../i18n';

interface PluginConfigurationGeneralProps {
  visible: boolean;
}

/** General instructions for configuring a feed per game. */
export function PluginConfigurationGeneral({ visible }: PluginConfigurationGeneralProps) {
  return (
    <div className="DialogBody" style={{ width: '100%', display: visible ? undefined : 'none' }}>
      {getPluginI18nString('configureFeedHint')}
    </div>
  );
}
