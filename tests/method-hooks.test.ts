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
    get() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Assert the native getter's receiver.
      receiver = this;
      return function (this: Child) { return this; };
    },
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

/** Steam's `@bind` decorator: a lazy prototype getter that installs a bound copy per instance. */
function bindDecorated<T extends object>(prototype: T, name: string, method: (this: any, ...args: any[]) => unknown) {
  Object.defineProperty(prototype, name, {
    configurable: true,
    get() {
      const bound = method.bind(this);
      if (!Object.prototype.hasOwnProperty.call(this, name))
        Object.defineProperty(this, name, { value: bound });
      return bound;
    },
  });
}

test('bind-decorated methods stay bound when passed detached', () => {
  class Card { declare OnClick: (amount: number) => number; value = 2; }
  bindDecorated(Card.prototype, 'OnClick', function (this: Card, amount: number) { return this.value * amount; });
  const descriptor = Object.getOwnPropertyDescriptor(Card.prototype, 'OnClick');
  const hooks = new MethodHooks();
  const receivers: Card[] = [];
  hooks.wrap(Card.prototype, 'OnClick', (original, instance) => {
    receivers.push(instance);
    return original() + 1;
  });

  const card = new Card();
  const detached = card.OnClick;
  expect(detached(3)).toBe(7);
  expect(card.OnClick).toBe(detached);
  // Calling the native getter must not install its bound original over the hook.
  expect(card.OnClick(3)).toBe(7);
  expect(receivers).toEqual([card, card]);

  hooks.restore();
  expect(Object.getOwnPropertyDescriptor(Card.prototype, 'OnClick')).toEqual(descriptor);
  expect(detached(3)).toBe(6);
  const fresh = new Card();
  const freshDetached = fresh.OnClick;
  expect(freshDetached(3)).toBe(6);
});

test('instances bound before the hook keep their native method', () => {
  class Card { declare OnClick: () => number; value = 2; }
  bindDecorated(Card.prototype, 'OnClick', function (this: Card) { return this.value; });
  const early = new Card();
  void early.OnClick;
  const hooks = new MethodHooks();
  hooks.wrap(Card.prototype, 'OnClick', original => original() + 1);
  const late = new Card();
  const detached = late.OnClick;
  expect(early.OnClick()).toBe(2);
  expect(detached()).toBe(3);
  hooks.restore();
});

test('later wrappers can assign over a bind-decorated hook', () => {
  class Card { declare OnClick: () => number; value = 2; }
  bindDecorated(Card.prototype, 'OnClick', function (this: Card) { return this.value; });
  const hooks = new MethodHooks();
  hooks.wrap(Card.prototype, 'OnClick', original => original() * 10);
  const inner = Card.prototype.OnClick;
  Card.prototype.OnClick = function (this: Card) { return inner.call(this) + 1; };
  expect(new Card().OnClick()).toBe(21);
  hooks.restore();
  expect(new Card().OnClick()).toBe(3);
});
