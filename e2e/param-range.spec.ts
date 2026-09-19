import { expect, test, type Page } from './fixtures';

/**
 * The AudioParam range a preset's enumeration value has to survive, checked on
 * the route a player actually takes.
 *
 * `engine.setParam` clamps every value to the range the worklet advertises in
 * `parameterDescriptors` before it writes the AudioParam, and the browser clamps
 * to that same range again. A descriptor that stops short of the engine's
 * enumeration therefore does not protect anything — it rewrites the value into a
 * *different* algorithm. That is what the table used to do with `osc1Wave`
 * (0..7 while `Wave::from_u32` accepts 8 = wavetable and 9 = sample) and
 * `filterType` (0..3 while `FilterType::from_u32` accepts 4 = comb, 5 = formant,
 * 6 = sem), so `wtorgan` and the SEM presets played brown noise and a notch
 * filter respectively.
 *
 * `src/audio/param-range.test.ts` holds the table against the engine's decoding
 * rules as data. What only a browser can add is that the value really travels
 * this route: the preset's enum id has to be what lands on the AudioParam. The
 * probe below records the writes instead of trusting the UI state, which keeps
 * showing the value the player picked no matter what the worklet received.
 */

interface Probe {
  /** name -> advertised range plus the live AudioParam, as the worklet declares it. */
  params: Record<string, { min: number; max: number; param: AudioParam }>;
  /** Every value written to a named AudioParam. */
  events: Array<{ name: string; value: number }>;
}

/** Tag every AudioParam with its name and record what is written to it. */
function installParamProbe() {
  const probe = { params: {}, events: [] } as Probe;
  (window as unknown as { __gsProbe: typeof probe }).__gsProbe = probe;

  const names = new WeakMap<object, string>();
  const Orig = window.AudioWorkletNode;
  function Wrapped(this: unknown, ...args: unknown[]) {
    const node = new (Orig as unknown as new (...a: unknown[]) => AudioWorkletNode)(...args);
    try {
      for (const [name, param] of node.parameters) {
        names.set(param, name);
        probe.params[name] = { min: param.minValue, max: param.maxValue, param };
      }
    } catch {
      /* the probe must never break the app under test */
    }
    return node;
  }
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = Wrapped;

  const write = (kind: 'setValueAtTime' | 'setTargetAtTime') => {
    const orig = (AudioParam.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[kind];
    (AudioParam.prototype as unknown as Record<string, unknown>)[kind] = function (
      this: AudioParam,
      ...args: unknown[]
    ) {
      const name = names.get(this);
      if (name) probe.events.push({ name, value: Number(args[0]) });
      return orig.apply(this, args);
    };
  };
  write('setValueAtTime');
  write('setTargetAtTime');
}

async function boot(page: Page) {
  await page.addInitScript(installParamProbe);
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__gsProbe?.params.osc1Wave))).toBe(true);
}

async function loadPreset(page: Page, name: string) {
  await page.evaluate(() => {
    window.__gsProbe.events = [];
  });
  await page.getByRole('button', { name: '预设库' }).click();
  await page.locator('.pcard', { hasText: name }).first().click();
  await page.locator('.preset-drawer .d-close').click();
}

/** The last value the engine wrote to one AudioParam since the last preset load. */
async function lastWrite(page: Page, name: string) {
  return page.evaluate((n) => {
    const writes = window.__gsProbe.events.filter((e) => e.name === n);
    return writes.length ? writes[writes.length - 1].value : null;
  }, name);
}

/** The range the worklet advertised and the AudioParam's current value. */
async function advertised(page: Page, name: string) {
  return page.evaluate((n) => {
    const entry = window.__gsProbe.params[n];
    return entry ? { min: entry.min, max: entry.max, value: entry.param.value } : null;
  }, name);
}

test.describe('AudioParam range vs engine enum', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(120_000);

  test('a wavetable preset reaches the DSP as a wavetable', async ({ page }) => {
    await boot(page);

    await loadPreset(page, 'Wavetable Organ');
    // The preset stores OSC1_WAVE = 8 (src/state/presets.ts). Before the fix the
    // engine's clamp turned that into 7 (brown noise) before it ever reached the
    // worklet, while the UI still showed the wavetable as selected.
    await expect.poll(() => lastWrite(page, 'osc1Wave')).toBe(8);
    // The readback agrees: 8 is inside the advertised range, so neither the app's
    // clamp nor the browser's rewrote it.
    expect((await advertised(page, 'osc1Wave'))!.value).toBe(8);

    // And the range the browser was actually given — not a copy of the source.
    const wave = await advertised(page, 'osc1Wave');
    expect(wave, 'osc1Wave has no descriptor').not.toBeNull();
    expect(wave!.max, 'AudioParam range cannot carry Wave::Wavetable (8)').toBeGreaterThanOrEqual(8);
  });

  test('a SEM preset reaches the DSP as a SEM filter', async ({ page }) => {
    await boot(page);

    await loadPreset(page, 'SEM Morph Pad');
    // The preset stores FILTER_TYPE = 6 (= sem; 3 would be notch).
    await expect.poll(() => lastWrite(page, 'filterType')).toBe(6);
    expect((await advertised(page, 'filterType'))!.value).toBe(6);

    const filter = await advertised(page, 'filterType');
    expect(filter, 'filterType has no descriptor').not.toBeNull();
    expect(filter!.max, 'AudioParam range cannot carry FilterType::Sem (6)').toBeGreaterThanOrEqual(6);
  });

  test('the effect chain can carry every kind the UI offers', async ({ page }) => {
    await boot(page);
    // TRANSIENT is the last entry of FX_KINDS (`src/audio/params.ts`), i.e. 9 —
    // and `src/state/fxtemplates.ts` clamps a saved template's chain kind to
    // `FX_KINDS.length - 1`, so 9 is a value the product itself writes. It used
    // to arrive as 8 (EQ).
    const chain = await advertised(page, 'fxChain1');
    expect(chain, 'fxChain1 has no descriptor').not.toBeNull();
    expect(chain!.max, 'AudioParam range cannot carry FxKind::Transient (9)').toBeGreaterThanOrEqual(9);
  });
});
