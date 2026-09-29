import { DialogCheckbox, DropdownItem, findModuleExport } from 'millennium';
import { useMemo, type ComponentProps, type ComponentType } from 'react';

export interface NumericOption {
  data: number;
  label: string;
}

export interface NativeToggleProps {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}

export interface NativeDropdownProps {
  label: string;
  description: string;
  rgOptions: NumericOption[];
  selectedOption: number;
  disabled: boolean;
  onChange(option: NumericOption): void;
  contextMenuPositionOptions: DropdownMenuOptions;
}

export interface NativeControls {
  ToggleRow: ComponentType<NativeToggleProps>;
  DropdownRow: ComponentType<NativeDropdownProps>;
}

type DropdownMenuOptions = ComponentProps<typeof DropdownItem>['contextMenuPositionOptions'];

/**
 * Resolve native property controls once per mounted editor.
 * @returns An object containing the native ToggleRow and DropdownRow components.
 */
export function useNativeControls(): NativeControls {
  return useMemo(() => {
    const nativeToggle = findModuleExport(value => typeof value === 'function'
      && typeof value.prototype?.OnToggleChange === 'function'
      && typeof value.prototype?.render === 'function'
      && String(value.prototype.render).includes('OnToggleChange')) as ComponentType<NativeToggleProps> | undefined;

    const nativeDropdown = findModuleExport(value => typeof value === 'function'
      && String(value).includes('dropDownControlRef')
      && String(value).includes('childrenContainerWidth')
      && String(value).includes('contextMenuPositionOptions')) as ComponentType<NativeDropdownProps> | undefined;

    return { ToggleRow: nativeToggle || DialogCheckbox, DropdownRow: nativeDropdown || DropdownItem };
  }, []);
}
