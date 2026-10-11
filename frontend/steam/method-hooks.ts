type Callable = (...args: any[]) => any;

type MethodName<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Callable ? K : never
}[keyof T];

type Method<T, K extends MethodName<T>> = Extract<NonNullable<T[K]>, Callable>;

type Intercept<T, K extends MethodName<T>> = (
  original: () => ReturnType<Method<T, K>>,
  instance: T,
  args: Parameters<Method<T, K>>,
) => ReturnType<Method<T, K>>;

/** Own a group of hooks without removing later plugins' wrappers. */
export class MethodHooks {
  private stopped = false;
  private restorations: (() => void)[] = [];

  /** Wrap a method on the target object with the provided intercept function. */
  wrap<T extends object, K extends MethodName<T>>(target: T, name: K, intercept: Intercept<T, K>): void {
    const ownDescriptor = Object.getOwnPropertyDescriptor(target, name);
    let descriptor = ownDescriptor;
    for (let parent = Object.getPrototypeOf(target); !descriptor && parent; parent = Object.getPrototypeOf(parent))
      descriptor = Object.getOwnPropertyDescriptor(parent, name);

    const useSetter = ownDescriptor && !ownDescriptor.configurable && !!ownDescriptor.set;
    const originalGetter = useSetter ? undefined : descriptor?.get;
    const originalValue = originalGetter ? undefined : Reflect.get(target, name);
    const isStopped = () => this.stopped;

    /** Install a bound copy of the replacement on an instance, as Steam's `@bind` getter does. */
    const bindTo = (instance: T) => {
      const bound = replacement.bind(instance);
      // Own and configurable: the native getter then keeps it instead of
      // installing its bound original, which would bypass this hook.
      Object.defineProperty(instance, name, { configurable: true, writable: true, value: bound });
      return bound;
    };

    const canBind = (instance: unknown): instance is T => instance !== target
      && (typeof instance === 'object' || typeof instance === 'function') && instance !== null
      && Object.isExtensible(instance) && !Object.prototype.hasOwnProperty.call(instance, name);

    const replacement = function (this: T, ...args: Parameters<Method<T, K>>) {
      const original = () => {
        if (originalGetter && canBind(this))
          bindTo(this);
        const method = originalGetter ? originalGetter.call(this) : originalValue;
        return method?.apply(this, args);
      };

      return isStopped()
        ? original()
        : intercept(original, this, args);
    };

    // Steam's `@bind` decorator exposes methods through a lazy prototype getter
    // that binds them per instance; Steam passes such methods detached as
    // callbacks. Keep that contract. Non-configurable store accessors retain their setter.
    const bindingGetter = originalGetter && function (this: T) {
      return canBind(this) ? bindTo(this) : replacement;
    };

    if (useSetter) {
      Reflect.set(target, name, replacement);
    } else if (bindingGetter) {
      Object.defineProperty(target, name, {
        configurable: ownDescriptor?.configurable ?? true,
        enumerable: ownDescriptor?.enumerable ?? false,
        get: bindingGetter,
        // Later wrappers (e.g. other plugins) may assign over this method.
        set(this: T, value: unknown) {
          Object.defineProperty(this, name, { configurable: true, enumerable: false, writable: true, value });
        },
      });
    } else {
      Object.defineProperty(target, name, {
        configurable: ownDescriptor?.configurable ?? true,
        enumerable: ownDescriptor?.enumerable ?? false,
        writable: ownDescriptor && 'writable' in ownDescriptor ? ownDescriptor.writable : true,
        value: replacement,
      });
    }

    this.restorations.push(() => {
      const installed = Object.getOwnPropertyDescriptor(target, name);
      const current = useSetter ? Reflect.get(target, name) : bindingGetter ? installed?.get : installed?.value;
      if (current !== (bindingGetter || replacement))
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
