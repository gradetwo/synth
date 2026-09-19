import { type Page } from '@playwright/test';

/**
 * Can this host run a realtime `AudioContext` at all?
 *
 * The release container mounts a tmpfs over `/dev` (there is no `/dev/snd`) and
 * starts no PulseAudio daemon, so on Firefox libpulse cannot even create its
 * runtime directory -- the browser prints, over and over on stderr,
 * `Failed to create secure directory (/run/user/1000/pulse): Read-only file
 * system`, and cubeb ends up with no backend. Every realtime `AudioContext`
 * then stays `suspended` for ever: `resume()` never settles (neither resolves
 * nor rejects), whether the context was created before a gesture or inside one,
 * and whatever sample rate is requested. Chromium is unaffected because it
 * falls back to a null sink, so its contexts report `running` and the synth
 * boots normally there.
 *
 * That is a property of the host, not of the synth. An `OfflineAudioContext`
 * renders fine, and the app's `audioWorklet.addModule()` plus `new
 * AudioWorkletNode()` both succeed -- the graph is built; only the output device
 * is missing. So specs whose observable is audio ask this question first and
 * skip with the reading, instead of reporting the host's missing sound card as
 * a product red. The raw evidence and how to re-run the probes are in
 * `docs/notes/compat.md`.
 *
 * The probe is a fresh `AudioContext` built from no app code, created and
 * resumed inside a trusted click (Firefox refuses a context it considers
 * gesture-less, so this is the strongest form of the question). It therefore
 * cannot be faked by an app-level regression: if the synth breaks while the
 * host can still run a bare context, this returns `null` and the specs still
 * run and still fail.
 */
type ProbeResult = {
  sampleRate: number;
  state: string;
  settled: 'pending' | 'resolved' | 'rejected' | 'timeout';
  error?: string;
};

/** One answer per engine is enough: the host does not change during a run. */
const cache = new Map<string, string | null>();

/**
 * `null` when this host can run a bare realtime context (so audio specs must
 * keep asserting), otherwise a human-readable reason to skip with.
 */
export async function hostAudioUnavailableReason(page: Page): Promise<string | null> {
  const engine = page.context().browser()?.browserType().name() ?? 'unknown';
  if (!cache.has(engine)) cache.set(engine, await probe(page));
  const reason = cache.get(engine) ?? null;
  // The skip has to say *why* in the terminal, not only in the HTML report.
  if (reason) console.log(`[audio-host] ${engine}: skip audio assertions -- ${reason}`);
  return reason;
}

async function probe(appPage: Page): Promise<string | null> {
  // A throwaway page, not the app page: `src/App.tsx` installs window-wide
  // `pointerdown`/`keydown` handlers that *start the engine* on any gesture, so
  // clicking a probe button inside the app would boot it and break the tests
  // that assert the start gate is still up.
  const page = await appPage.context().newPage();
  try {
    await page.goto('about:blank');
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = '__audio_host_probe';
      btn.type = 'button';
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
      // Laid out (Playwright will not click a zero-size element) but out of the
      // way, and on top so the click really lands on it.
      btn.style.cssText =
        'position:fixed;left:0;bottom:0;width:8px;height:8px;padding:0;border:0;opacity:0.01;z-index:2147483647';
      btn.addEventListener('click', () => {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        const win = window as unknown as { __audioHostProbe?: ProbeResult };
        const result: ProbeResult = { sampleRate: ctx.sampleRate, state: ctx.state, settled: 'pending' };
        win.__audioHostProbe = result;
        const finish = (settled: ProbeResult['settled']) => {
          result.settled = settled;
          result.state = ctx.state;
          void ctx.close().catch(() => undefined);
        };
        ctx.resume().then(
          () => {
            if (result.settled === 'pending') finish('resolved');
          },
          (err: unknown) => {
            // Closing the context after the timeout makes the pending resume
            // reject with InvalidStateError; keep the timeout as the answer.
            if (result.settled === 'pending') {
              result.error = String(err);
              finish('rejected');
            }
          },
        );
        // Firefox leaves `resume()` pending for ever here; bound the wait so the
        // probe can report the state it is stuck in.
        setTimeout(() => {
          if (result.settled === 'pending') finish('timeout');
        }, 3000);
      });
      (document.body ?? document.documentElement).appendChild(btn);
    });

    await page.locator('#__audio_host_probe').click({ force: true, timeout: 10_000 });
    const result = await page
      .waitForFunction(
        () => {
          const win = window as unknown as { __audioHostProbe?: ProbeResult };
          return win.__audioHostProbe != null && win.__audioHostProbe.settled !== 'pending';
        },
        undefined,
        { timeout: 10_000 },
      )
      .then(() =>
        page.evaluate(
          () => (window as unknown as { __audioHostProbe?: ProbeResult }).__audioHostProbe ?? null,
        ),
      )
      .catch(() => null);

    if (result && result.state === 'running') return null;
    return (
      'this host has no usable audio output: a bare AudioContext created and resumed inside a click ' +
      `stayed "${result?.state ?? 'unknown'}" (resume ${result?.settled ?? 'never ran'}` +
      `${result?.error ? `, ${result.error}` : ''}), sample rate ${result?.sampleRate ?? '?'} Hz, and no ` +
      'output device is enumerable. Firefox has no cubeb backend here (no /dev/snd, no PulseAudio); ' +
      'Chromium falls back to a null sink and is unaffected. See docs/notes/compat.md.'
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}
