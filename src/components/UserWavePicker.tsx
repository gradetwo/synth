/**
 * Import / use / remove the single-cycle wavetable (A6.2).
 *
 * Only shown while an oscillator plays the wavetable wave, because that is the
 * only time the imported cycle can be heard. The switch writes the `wtUser`
 * parameter, which travels with the patch like any other switch; the cycle
 * itself is instrument state and is shared by every patch.
 */

import { useRef, useSyncExternalStore } from 'react';
import { Param } from '@/audio/params';
import { WaveImportError } from '@/audio/wavefile';
import {
  clearUserWave,
  getUserWave,
  importUserWave,
  subscribeUserWave,
} from '@/audio/userWave';
import { useParam } from '@/hooks/useSynth';
import { store } from '@/state/store';
import { t } from '@/i18n';
import { toast } from './Toast';

function failureMessage(error: unknown): string {
  const code = error instanceof WaveImportError ? error.code : 'decode';
  switch (code) {
    case 'short':
      return t('wt.err.short');
    case 'silent':
      return t('wt.err.silent');
    case 'notFinite':
      return t('wt.err.notFinite');
    default:
      return t('wt.err.decode');
  }
}

export function UserWavePicker({ which }: { which: 1 | 2 }) {
  const loaded = useSyncExternalStore(subscribeUserWave, getUserWave, getUserWave);
  const useUser = useParam(Param.WT_USER) >= 0.5;
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File) => {
    try {
      const wave = await importUserWave(file);
      // Importing is a statement of intent: the player wants to hear it, so the
      // switch follows rather than leaving them with an unchanged patch.
      store.setParam(Param.WT_USER, 1, { immediate: true });
      toast(t('wt.loaded', { name: wave.name }));
    } catch (error) {
      toast(failureMessage(error));
    }
  };

  return (
    <div className="wt-row" data-wt={which}>
      <button
        type="button"
        className="roll-btn"
        data-act="import"
        title={t('wt.hint')}
        onClick={() => fileRef.current?.click()}
      >
        {t('wt.import')}
      </button>
      <button
        type="button"
        className={`roll-btn${useUser ? ' on' : ''}`}
        data-act="use"
        data-setting="wtUser"
        disabled={!loaded}
        aria-pressed={useUser}
        onClick={() => store.setParam(Param.WT_USER, useUser ? 0 : 1, { immediate: true })}
      >
        {t('wt.use')}
      </button>
      {loaded && (
        <button
          type="button"
          className="roll-btn"
          data-act="clear"
          title={t('wt.clearHint')}
          onClick={() => {
            clearUserWave();
            store.setParam(Param.WT_USER, 0, { immediate: true });
            toast(t('wt.cleared'));
          }}
        >
          ✕
        </button>
      )}
      <span className="wt-name" data-act="name" title={loaded?.name ?? ''}>
        {loaded ? loaded.name : t('wt.none')}
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
  );
}
