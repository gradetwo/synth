/**
 * Import / play / remove the sampler's sample (A).
 *
 * Shown while an oscillator plays the sample wave, which is the only time the
 * imported audio can be heard. The wave switch and the root note are patch
 * state; the sample itself is instrument state, shared by every patch.
 */

import { useRef, useSyncExternalStore } from 'react';
import { Param, SPEC_BY_ID, type ParamId } from '@/audio/params';
import { WaveImportError } from '@/audio/wavefile';
import {
  clearUserSample,
  getUserSample,
  importUserSample,
  subscribeUserSample,
} from '@/audio/userSample';
import { useParam } from '@/hooks/useSynth';
import { useStringsReady } from '@/hooks/useStringsReady';
import { store } from '@/state/store';
import { t } from '@/i18n';
import { Knob, Segment } from './controls';
import { toast } from './Toast';

const MODES = [
  { label: 'ONE', value: 0, title: 'smp.modeOneShot' },
  { label: 'LOOP', value: 1, title: 'smp.modeLoop' },
  { label: 'P-P', value: 2, title: 'smp.modePingPong' },
];

function failureMessage(error: unknown): string {
  const code = error instanceof WaveImportError ? error.code : 'decode';
  switch (code) {
    case 'short':
      return t('smp.err.short');
    case 'silent':
      return t('smp.err.silent');
    case 'notFinite':
      return t('smp.err.notFinite');
    case 'noRoom':
      return t('smp.err.noRoom');
    default:
      return t('smp.err.decode');
  }
}

export function UserSamplePicker({ which }: { which: 1 | 2 }) {
  const loaded = useSyncExternalStore(subscribeUserSample, getUserSample, getUserSample);
  const mode = Math.round(useParam(Param.SMP_MODE));
  const fileRef = useRef<HTMLInputElement>(null);
  // This row is eager UI with lazy copy (P11.2); see `useStringsReady`.
  const stringsReady = useStringsReady(['smp.import']);

  if (!stringsReady) return null;

  const pick = async (file: File) => {
    try {
      const { sample, truncated } = await importUserSample(file);
      // Importing is a statement of intent: play it.
      // Switch this oscillator to the sample wave: importing and then having to
      // find the wave in the selector would be a step for nothing.
      store.setParam(
        (which === 1 ? Param.OSC1_WAVE : Param.OSC2_WAVE) as ParamId,
        9,
        { immediate: true },
      );
      // A file over 4 s keeps its first 4 s (P9.8). One toast, not two — the
      // second would overwrite the first before it could be read — and the
      // truncated one says what happened instead of just naming the sample.
      toast(t(truncated ? 'smp.loadedTruncated' : 'smp.loaded', { name: sample.name }));
    } catch (error) {
      toast(failureMessage(error));
    }
  };

  return (
    <>
      <div className="wt-row" data-smp={which}>
        <button
          type="button"
          className="roll-btn"
          data-act="import"
          title={t('smp.hint')}
          onClick={() => fileRef.current?.click()}
        >
          {t('smp.import')}
        </button>
        {loaded && (
          <button
            type="button"
            className="roll-btn"
            data-act="clear"
            title={t('smp.clearHint')}
            onClick={() => {
              clearUserSample();
              toast(t('smp.cleared'));
            }}
          >
            ✕
          </button>
        )}
        <span className="wt-name" data-act="name" title={loaded?.name ?? ''}>
          {loaded ? loaded.name : t('smp.none')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.wave,.aif,.aiff,.flac,.ogg,.mp3"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
      </div>
      <div className="smp-controls">
        <Knob spec={SPEC_BY_ID[Param.SMP_ROOT]} />
        <Segment
          value={mode}
          options={MODES.map((option) => ({
            label: option.label,
            value: option.value,
            title: t(option.title),
          }))}
          onChange={(value) => store.setParam(Param.SMP_MODE as ParamId, value, { immediate: true })}
        />
        {mode !== 0 && (
          <>
            <Knob spec={SPEC_BY_ID[Param.SMP_LOOP_START]} />
            <Knob spec={SPEC_BY_ID[Param.SMP_LOOP_END]} />
          </>
        )}
      </div>
    </>
  );
}
