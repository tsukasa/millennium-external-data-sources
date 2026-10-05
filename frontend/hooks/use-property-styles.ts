import { findClassModule } from 'millennium';
import { useMemo } from 'react';

export interface PropertyStyles {
  classes?: Record<string, string>;
  buttonClass: string;
}

/** Resolve native properties classes once per mounted editor. */
export function usePropertyStyles(): PropertyStyles {
  return useMemo(() => {
    const classes = findClassModule(m => m.SectionTopLine) as Record<string, string> | undefined;
    const buttons = findClassModule(m => m.DialogButton && m.Focusable) as Record<string, string> | undefined;
    const buttonClass = [
      buttons?.DialogButton || '_1KAp5PPYG7si-T_66zNEcU',
      buttons?.Focusable || '_2MgqWIMDzJajWDw345eImx',
      'SettingsDialogButton', 'DialogButton', '_DialogLayout', 'Secondary', 'Focusable',
    ].join(' ');
    return { classes, buttonClass };
  }, []);
}
