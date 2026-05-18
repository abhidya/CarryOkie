// Brownfield DOM helper compatibility for `src/app.ts`.
// The app uses a tiny `$()` selector that returns `Element | null` at runtime,
// while handlers narrow by known template IDs. This keeps typecheck useful for
// modules without rewriting the whole single-file UI controller in one pass.
interface Element {
  onclick: ((this: GlobalEventHandlers, ev: MouseEvent) => unknown) | null;
  onchange: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  oninput: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  onpointerdown: ((this: GlobalEventHandlers, ev: PointerEvent) => unknown) | null;
  onpointerup: ((this: GlobalEventHandlers, ev: PointerEvent) => unknown) | null;
  onpointercancel: ((this: GlobalEventHandlers, ev: PointerEvent) => unknown) | null;
  onpointerleave: ((this: GlobalEventHandlers, ev: PointerEvent) => unknown) | null;
  value: string;
  checked: boolean;
  disabled: boolean;
  dataset: DOMStringMap;
  style: CSSStyleDeclaration;
  src: string;
  poster: string;
  muted: boolean;
  playsInline: boolean;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}
