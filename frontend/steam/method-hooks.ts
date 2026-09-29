type Callable = (...args: any[]) => any;

export type MethodName<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Callable ? K : never
}[keyof T];

export type Method<T, K extends MethodName<T>> = Extract<NonNullable<T[K]>, Callable>;

export type Intercept<T, K extends MethodName<T>> = (
  original: () => ReturnType<Method<T, K>>,
  instance: T,
  args: Parameters<Method<T, K>>,
) => ReturnType<Method<T, K>>;

/**
 * Own a group of hooks without removing later plugins' wrappers.
 */
export class MethodHooks {
  private stopped = false;
  private restorations: (() => void)[] = [];

  /**
   * Wrap a method on the target object with the provided intercept function.
   * @param target The object containing the method to wrap.
   * @param name The name of the method to wrap.
   * @param intercept The intercept function to apply to the method.
   */
  wrap<T extends object, K extends MethodName<T>>(target: T, name: K, intercept: Intercept<T, K>): void {
    const ownDescriptor = Object.getOwnPropertyDescriptor(target, name);
    let descriptor = ownDescriptor;
    for (let parent = Object.getPrototypeOf(target); !descriptor && parent; parent = Object.getPrototypeOf(parent))
      descriptor = Object.getOwnPropertyDescriptor(parent, name);

    const useSetter = ownDescriptor && !ownDescriptor.configurable && !!ownDescriptor.set;
    const originalGetter = useSetter ? undefined : descriptor?.get;
    const originalValue = originalGetter ? undefined : Reflect.get(target, name);
    const hooks = this;
    const replacement = function (this: T, ...args: Parameters<Method<T, K>>) {
      const original = () => {
        const method = originalGetter ? originalGetter.call(this) : originalValue;
        return method?.apply(this, args);
      };
      return hooks.stopped ? original() : intercept(original, this, args);
    };

    // Configurable prototype getters (including MobX render getters) need a
    // value descriptor. Non-configurable store accessors retain their setter.
    if (useSetter) {
      Reflect.set(target, name, replacement);
    } else {
      Object.defineProperty(target, name, {
        configurable: ownDescriptor?.configurable ?? true,
        enumerable: ownDescriptor?.enumerable ?? false,
        writable: ownDescriptor && 'writable' in ownDescriptor ? ownDescriptor.writable : true,
        value: replacement,
      });
    }

    this.restorations.push(() => {
      const current = useSetter ? Reflect.get(target, name) : Object.getOwnPropertyDescriptor(target, name)?.value;
      if (current !== replacement)
        return;
      if (useSetter)
        Reflect.set(target, name, originalValue);
      else if (ownDescriptor)
        Object.defineProperty(target, name, ownDescriptor);
      else
        Reflect.deleteProperty(target, name);
    });
  }

  /**
   * Restore all wrapped methods to their original implementations.
   * This will stop all intercepts and remove the hooks owned by this instance.
   */
  restore(): void {
    this.stopped = true;
    // Wrappers retained by other plugins still close over their original method.
    for (const restore of this.restorations.splice(0).reverse())
      restore();
  }
}
