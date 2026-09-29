import { expect, test } from 'bun:test';
import { MethodHooks } from '../frontend/steam/method-hooks';

test('hooks retained by another plugin delegate with the original receiver and arguments after cleanup', () => {
  const target = { value: 4, method(add: number) { return this.value + add; } };
  const hooks = new MethodHooks();
  const original = target.method;
  hooks.wrap(target, 'method', call => call() * 2);
  const inner = target.method;
  const foreign = function (this: typeof target, add: number) { return inner.call(this, add) + 1; };
  target.method = foreign;
  expect(target.method(3)).toBe(15);
  hooks.restore();
  hooks.restore();
  expect(target.method).toBe(foreign);
  expect(target.method(3)).toBe(8);
  expect(original.call(target, 3)).toBe(7);
});

test('prototype getter methods and inherited methods restore their descriptors', () => {
  class Parent { method() { return this; } }
  class Child extends Parent { declare render: () => Child; }
  const hooks = new MethodHooks();
  const instance = new Child();
  let receiver: unknown;
  Object.defineProperty(Child.prototype, 'render', {
    configurable: true,
    get() { receiver = this; return function (this: Child) { return this; }; },
  });
  const descriptor = Object.getOwnPropertyDescriptor(Child.prototype, 'render');
  hooks.wrap(Child.prototype, 'render', call => call());
  hooks.wrap(Child.prototype, 'method', call => call());
  expect((instance as any).render()).toBe(instance);
  expect(receiver).toBe(instance);
  hooks.restore();
  expect(Object.getOwnPropertyDescriptor(Child.prototype, 'render')).toEqual(descriptor);
  expect(Object.prototype.hasOwnProperty.call(Child.prototype, 'method')).toBe(false);
  expect(instance.method()).toBe(instance);
});

test('non-configurable observable accessors retain their setters and original functions', () => {
  let value = () => 5;
  const original = value;
  const target = {} as { method(): number };
  Object.defineProperty(target, 'method', { get: () => value, set: next => { value = next; } });
  const hooks = new MethodHooks();
  hooks.wrap(target, 'method', call => call() + 2);
  expect((target as any).method()).toBe(7);
  hooks.restore();
  expect(value).toBe(original);
  expect((target as any).method()).toBe(5);
});
