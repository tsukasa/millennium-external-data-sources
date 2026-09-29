import { MethodHooks } from '../../frontend/steam/method-hooks';

/** Compile-only checks: hook signatures must retain the target method's contract. */
export function verifyHookTypes(): void {
  const hooks = new MethodHooks();
  const target = {
    count: 0,
    async update(name: string, count: number): Promise<boolean> {
      this.count = count;
      return name.length > 0;
    },
  };

  hooks.wrap(target, 'update', async (original, instance, [name, count]) => {
    instance.count = count;
    name.toUpperCase();
    return original();
  });

  // @ts-expect-error Nonexistent methods cannot be hooked.
  hooks.wrap(target, 'missing', () => undefined);
  // @ts-expect-error Data properties cannot be hooked.
  hooks.wrap(target, 'count', () => 0);
  // @ts-expect-error Interceptors must return the original method's result type.
  hooks.wrap(target, 'update', () => false);
  hooks.wrap(target, 'update', (original, _instance, [name]) => {
    // @ts-expect-error The first argument is a string, not a number.
    name.toFixed();
    return original();
  });
}
