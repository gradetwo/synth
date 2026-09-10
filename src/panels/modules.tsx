import { store } from '@/state/store';
import { useLang, useParam, useRoutes } from '@/hooks/useSynth';
import {
  DELAY_SYNCS,
  FX_KIND_LABELS,
  FX_SLOTS,
  LFO_TARGETS,
  LFO_WAVES,
  MOD_DESTS,
  MOD_DST_LABELS,
  MOD_SRC_LABELS,
  MOD_SOURCES,
  Param,
  SPEC_BY_ID,
  WAVES,
  filterToInt,
  intToDelaySync,
  intToFilter,
  intToModDst,
  intToModSrc,
  chainId,
  fxKindCanBeParallel,
  fxKindToInt,
  intToFxKind,
  modDstToInt,
  modSrcToInt,
  parallelId,
  type FxKind,
  type ParamId,
  type ParamSpec,
  type Wave,
  intToWave,
} from '@/audio/params';
import { wavetableName, wavetableValueToRecipe } from '@/audio/wavetable';
import type { ModuleId } from '@/state/layout';
import { Knob, Led, ParamLed, Segment, WaveSelect } from '@/components/controls';
import { FilterCurve, LfoRateLabel, MiniWave } from '@/components/canvas';
import { AdsrEditor } from '@/components/AdsrEditor';
import { ModuleShell } from '@/components/Module';
import { UserWavePicker } from '@/components/UserWavePicker';
import { t } from '@/i18n';

function ParamWaveSelect({ id, waves }: { id: number; waves: Wave[] }) {
  const value = Math.round(useParam(id as ParamId));
  return (
    <WaveSelect
      value={value}
      waves={waves}
      onChange={(i) => store.setParam(id as never, i, { immediate: true })}
    />
  );
}

function ParamSegment({
  id,
  options,
  colorful,
  label,
}: {
  id: number;
  options: { label: string; value: number; title?: string }[];
  colorful?: boolean;
  label?: string;
}) {
  const value = Math.round(useParam(id as ParamId));
  return (
    <Segment
      value={value}
      options={options}
      colorful={colorful}
      label={label}
      onChange={(v) => store.setParam(id as never, v, { immediate: true })}
    />
  );
}

// --------------------------------------------------------------------- OSC

function OscModule({ which }: { which: 1 | 2 }) {
  const color = which === 1 ? '#4da3ff' : '#35d0c5';
  const lang = useLang();
  const pitch = SPEC_BY_ID[which === 1 ? Param.OSC1_PITCH : Param.OSC2_PITCH];
  const detune = SPEC_BY_ID[which === 1 ? Param.OSC1_DETUNE : Param.OSC2_DETUNE];
  const level = SPEC_BY_ID[which === 1 ? Param.OSC1_LEVEL : Param.OSC2_LEVEL];
  const pw = SPEC_BY_ID[which === 1 ? Param.OSC1_PW : Param.OSC2_PW];
  const pan = SPEC_BY_ID[which === 1 ? Param.OSC1_PAN : Param.OSC2_PAN];
  const unison = SPEC_BY_ID[which === 1 ? Param.OSC1_UNISON : Param.OSC2_UNISON];
  const spread = SPEC_BY_ID[which === 1 ? Param.OSC1_SPREAD : Param.OSC2_SPREAD];
  // With the wavetable wave the PW knob picks the harmonic table, so say which
  // one it is rather than leaving the player to discover it.
  const wave = intToWave(useParam(which === 1 ? Param.OSC1_WAVE : Param.OSC2_WAVE));
  const pwValue = useParam(pw.id);
  const pwSpec =
    wave === 'wavetable'
      ? { ...pw, label: `WT ${wavetableName(wavetableValueToRecipe(pwValue), lang)}` }
      : pw;
  return (
    <ModuleShell id={which === 1 ? 'osc1' : 'osc2'}>
      <ParamWaveSelect id={which === 1 ? Param.OSC1_WAVE : Param.OSC2_WAVE} waves={WAVES} />
      <div className="knob-row">
        <Knob spec={pitch} />
        <Knob spec={detune} />
        <Knob spec={level} />
        <Knob spec={pwSpec} />
        <Knob spec={pan} />
        <Knob spec={unison} />
        <Knob spec={spread} />
      </div>
      {wave === 'wavetable' && <UserWavePicker which={which} />}
      <MiniWave which={which} color={color} />
      <div className="mini-label">WAVE PREVIEW</div>
    </ModuleShell>
  );
}

// ------------------------------------------------------------------ FILTER

function FilterModule() {
  const type = intToFilter(useParam(Param.FILTER_TYPE));
  return (
    <ModuleShell id="filter">
      <ParamSegment
        id={Param.FILTER_TYPE}
        colorful
        label={t('module.filterType')}
        options={[
          { label: 'LP', value: filterToInt('lp'), title: t('filter.lp') },
          { label: 'HP', value: filterToInt('hp'), title: t('filter.hp') },
          { label: 'BP', value: filterToInt('bp'), title: t('filter.bp') },
          { label: 'NT', value: filterToInt('nt'), title: t('filter.nt') },
          { label: 'CMB', value: filterToInt('comb'), title: t('filter.comb') },
          { label: 'FRM', value: filterToInt('formant'), title: t('filter.formant') },
        ]}
      />
      <div className="filter-grid">
        <Knob spec={SPEC_BY_ID[Param.FILTER_CUTOFF]} big />
        <div className="filter-side">
          <Knob spec={SPEC_BY_ID[Param.FILTER_RES]} />
          <Knob spec={SPEC_BY_ID[Param.FILTER_DRIVE]} />
          <Knob spec={SPEC_BY_ID[Param.FILTER_ENV_AMT]} />
          <div className="toggle-cell">
            <span className="lbl">KBD</span>
            <ParamLed id={Param.FILTER_KBD} label={t('module.kbdTrack')} />
          </div>
        </div>
      </div>
      <FilterCurve />
      <div className="mini-label">
        {type === 'comb'
          ? 'FREQ RESPONSE · COMB RESONATOR'
          : type === 'formant'
            ? 'FREQ RESPONSE · VOWEL A–E–I–O–U'
            : `FREQ RESPONSE · ${type === 'lp' ? '-24dB/OCT' : '-12dB/OCT'}`}
      </div>
    </ModuleShell>
  );
}

// --------------------------------------------------------------------- ENV

function EnvModule() {
  return (
    <ModuleShell id="env">
      <AdsrEditor title="AMP ENV" />
      <AdsrEditor
        title="FILTER ENV"
        ids={[Param.FILTER_ENV_ATTACK, Param.FILTER_ENV_DECAY, Param.FILTER_ENV_SUSTAIN, Param.FILTER_ENV_RELEASE]}
      />
      <div className="env-foot">
        <ParamSegment
          id={Param.VOICE_MODE}
          label={t('module.voiceMode')}
          options={[
            { label: 'POLY', value: 0, title: t('module.modePoly') },
            { label: 'MONO', value: 1, title: t('module.modeMono') },
            { label: 'LEGATO', value: 2, title: t('module.modeLegato') },
          ]}
        />
        <Knob spec={SPEC_BY_ID[Param.GLIDE]} />
      </div>
    </ModuleShell>
  );
}

// --------------------------------------------------------------------- LFO

function LfoModule() {
  return (
    <ModuleShell id="lfo">
      <ParamWaveSelect id={Param.LFO_WAVE} waves={LFO_WAVES} />
      <div className="knob-row">
        <Knob spec={SPEC_BY_ID[Param.LFO_RATE]} />
        <Knob spec={SPEC_BY_ID[Param.LFO_DEPTH]} />
      </div>
      <ParamSegment
        id={Param.LFO_TARGET}
        label={t('module.lfoTarget')}
        options={LFO_TARGETS.map((t, i) => ({ label: t.toUpperCase(), value: i }))}
      />
      <div className="lfo-foot">
        <MiniWave which={1} color="#fb923c" lfo />
        <ParamLed id={Param.LFO_SYNC} label={t('module.lfoSync')} />
        <span className="hint">SYNC</span>
        <LfoRateLabel />
      </div>
      <div className="lfo-modes">
        <ParamLed id={Param.LFO_RETRIG} label={t('module.lfoRetrig')} />
        <span className="hint">{t('module.lfoRetrigShort')}</span>
        <ParamLed id={Param.LFO_ONESHOT} label={t('module.lfoOneshot')} />
        <span className="hint">{t('module.lfoOneshotShort')}</span>
      </div>

      <div className="lfo2">
        <div className="module-subhead">
          <span className="bar" />
          <span className="title">LFO 2</span>
          <span className="spacer" />
          <ParamLed id={Param.LFO2_ON} label={t('module.lfo2On')} />
        </div>
        <ParamWaveSelect id={Param.LFO2_WAVE} waves={LFO_WAVES} />
        <div className="knob-row">
          <Knob spec={SPEC_BY_ID[Param.LFO2_RATE]} />
          <Knob spec={SPEC_BY_ID[Param.LFO2_DEPTH]} />
        </div>
        <ParamSegment
          id={Param.LFO2_TARGET}
          label={t('module.lfo2Target')}
          options={LFO_TARGETS.map((t, i) => ({ label: t.toUpperCase(), value: i }))}
        />
        <div className="lfo-modes">
          <ParamLed id={Param.LFO2_RETRIG} label={t('module.lfo2Retrig')} />
          <span className="hint">{t('module.lfoRetrigShort')}</span>
          <ParamLed id={Param.LFO2_ONESHOT} label={t('module.lfo2Oneshot')} />
          <span className="hint">{t('module.lfoOneshotShort')}</span>
        </div>
      </div>
    </ModuleShell>
  );
}

// ------------------------------------------------------------- MOD MATRIX

function ModMatrix() {
  const routes = useRoutes();
  return (
    <ModuleShell id="matrix">
      <div className="matrix-list">
        {routes.map((route, i) => (
          <div className="mrow" key={i}>
            <select
              className="badge badge-sel"
              style={{ color: 'var(--lfo)' }}
              value={modSrcToInt(route.src)}
              onChange={(e) => store.setRoute(i, { src: intToModSrc(Number(e.target.value)) })}
              aria-label={t('module.matrixSrc')}
            >
              {MOD_SOURCES.map((src, si) => (
                <option key={src} value={si}>
                  {MOD_SRC_LABELS[src]}
                </option>
              ))}
            </select>
            <span className="arrow">─▶</span>
            <select
              className="badge badge-sel"
              value={modDstToInt(route.dst)}
              onChange={(e) => store.setRoute(i, { dst: intToModDst(Number(e.target.value)) })}
              aria-label={t('module.matrixDst')}
            >
              {MOD_DESTS.map((dst, di) => (
                <option key={dst} value={di}>
                  {MOD_DST_LABELS[dst]}
                </option>
              ))}
            </select>
            <input
              type="range"
              className="mod-range bipolar"
              min={-1}
              max={1}
              step={0.01}
              value={route.amount}
              // The fill grows outwards from the centre, so the sign is visible.
              style={
                {
                  ['--p' as string]: `${((route.amount + 1) / 2) * 100}%`,
                  ['--c' as string]: '50%',
                } as React.CSSProperties
              }
              onChange={(e) => store.setRoute(i, { amount: Number(e.target.value) })}
              aria-label={t('module.matrixAmt')}
            />
            <Led
              on={route.enabled}
              onToggle={(v) => store.setRoute(i, { enabled: v })}
              label={t('module.matrixEnable')}
              color="var(--matrix)"
            />
            <button type="button" className="route-del" title={t('module.matrixDelete')} onClick={() => store.removeRoute(i)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add-route" onClick={() => store.addRoute()}>
        {t('module.addRoute')}
      </button>
    </ModuleShell>
  );
}

// ---------------------------------------------------------------------- FX

/**
 * The effect chain (A5): which effect runs at each of the six positions.
 *
 * Reordering is a swap between neighbours, which is what "reorderable" means
 * when every position holds one effect and the chain is a permutation — it can
 * never lose an effect or run one twice. Each chip also carries the send (∥)
 * switch where a send is meaningful.
 */
function FxChain() {
  // One hook per position, written out: a hook called from a loop or a callback
  // would break the rules of hooks the moment the chain length changed.
  const chain = [
    intToFxKind(useParam(chainId(0))),
    intToFxKind(useParam(chainId(1))),
    intToFxKind(useParam(chainId(2))),
    intToFxKind(useParam(chainId(3))),
    intToFxKind(useParam(chainId(4))),
    intToFxKind(useParam(chainId(5))),
  ];

  const swap = (a: number, b: number) => {
    const first = chain[a];
    const second = chain[b];
    store.setParam(chainId(a), fxKindToInt(second), { immediate: true });
    store.setParam(chainId(b), fxKindToInt(first), { immediate: true });
  };

  return (
    <div className="fx-chain" data-unit="chain">
      <div className="fx-chain-head" title={t('fx.chainHint')}>
        {t('fx.chain')}
      </div>
      <div className="fx-chain-list">
        {chain.map((kind, slot) => (
          <ChainChip
            key={slot}
            slot={slot}
            kind={kind}
            onSwap={swap}
          />
        ))}
      </div>
    </div>
  );
}

function ChainChip({
  slot,
  kind,
  onSwap,
}: {
  slot: number;
  kind: FxKind;
  onSwap: (a: number, b: number) => void;
}) {
  const parallel = useParam(parallelId(slot)) >= 0.5;
  return (
    <span className="fx-chip" data-slot={slot} data-kind={kind}>
      <button
        type="button"
        className="fx-move"
        data-act="left"
        aria-label={t('fx.moveLeft')}
        disabled={slot === 0}
        onClick={() => onSwap(slot, slot - 1)}
      >
        ‹
      </button>
      <span className="fx-chip-name">{FX_KIND_LABELS[kind]}</span>
      {fxKindCanBeParallel(kind) && (
        <button
          type="button"
          className={`fx-par${parallel ? ' on' : ''}`}
          data-act="parallel"
          data-setting={`fxParallel${slot + 1}`}
          aria-pressed={parallel}
          aria-label={t('fx.parallel')}
          title={t('fx.parallelHint')}
          onClick={() => store.setParam(parallelId(slot), parallel ? 0 : 1, { immediate: true })}
        >
          ∥
        </button>
      )}
      <button
        type="button"
        className="fx-move"
        data-act="right"
        aria-label={t('fx.moveRight')}
        disabled={slot === FX_SLOTS - 1}
        onClick={() => onSwap(slot, slot + 1)}
      >
        ›
      </button>
    </span>
  );
}

function FxModule() {
  const sync = intToDelaySync(useParam(Param.FX_DELAY_SYNC));
  const pingPong = useParam(Param.FX_DELAY_PINGPONG) >= 0.5;
  return (
    <ModuleShell id="fx">
      <FxChain />
      <div className="fx-grid">
        <div className="fx-unit" data-unit="reverb">
          <div className="fx-title">
            <ParamLed id={Param.FX_REVERB_ON} label={t('module.reverbOn')} />
            REVERB
          </div>
          <div className="knob-row">
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_SIZE]} />
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_MIX]} />
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_DAMP]} />
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_WIDTH]} />
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_PREDELAY]} />
          </div>
        </div>
        <div className="fx-sep" />
        <div className="fx-unit" data-unit="delay">
          <div className="fx-title">
            <ParamLed id={Param.FX_DELAY_ON} label={t('module.delayOn')} />
            DELAY
          </div>
          <div className="seg dly-sync">
            {DELAY_SYNCS.map((label, i) => (
              <button
                key={label}
                type="button"
                className={label === sync ? 'active' : ''}
                onClick={() => store.setParam(Param.FX_DELAY_SYNC, i, { immediate: true })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="knob-row">
            <Knob spec={SPEC_BY_ID[Param.FX_DELAY_FB]} />
            <Knob spec={SPEC_BY_ID[Param.FX_DELAY_MIX]} />
            <Knob spec={SPEC_BY_ID[Param.FX_DELAY_DAMP]} />
          </div>
          <button
            type="button"
            className={`dly-ping${pingPong ? ' on' : ''}`}
            data-setting="delayPingPong"
            aria-pressed={pingPong}
            title={t('fx.pingPongHint')}
            onClick={() => store.setParam(Param.FX_DELAY_PINGPONG, pingPong ? 0 : 1, { immediate: true })}
          >
            {t('fx.pingPong')}
          </button>
        </div>
      </div>
    </ModuleShell>
  );
}

// --------------------------------------------------------------------- FX 2

function FxStrip({ title, ledId, specs }: { title: string; ledId: number; specs: ParamSpec[] }) {
  return (
    <div className="fx2-strip">
      <div className="fx-title">
        <ParamLed id={ledId} label={t('module.ledAria', { title })} />
        {title}
      </div>
      <div className="knob-row">
        {specs.map((spec) => (
          <Knob key={spec.id} spec={spec} />
        ))}
      </div>
    </div>
  );
}

function Fx2Module() {
  return (
    <ModuleShell id="fx2">
      <div className="fx2-grid">
        <FxStrip
          title="CHORUS"
          ledId={Param.FX_CHORUS_ON}
          specs={[SPEC_BY_ID[Param.FX_CHORUS_DEPTH], SPEC_BY_ID[Param.FX_CHORUS_RATE], SPEC_BY_ID[Param.FX_CHORUS_MIX]]}
        />
        <FxStrip
          title="FLANGER"
          ledId={Param.FX_FLANGER_ON}
          specs={[SPEC_BY_ID[Param.FX_FLANGER_RATE], SPEC_BY_ID[Param.FX_FLANGER_FB], SPEC_BY_ID[Param.FX_FLANGER_MIX]]}
        />
        <FxStrip
          title="PHASER"
          ledId={Param.FX_PHASER_ON}
          specs={[SPEC_BY_ID[Param.FX_PHASER_RATE], SPEC_BY_ID[Param.FX_PHASER_FB], SPEC_BY_ID[Param.FX_PHASER_MIX]]}
        />
        <FxStrip
          title="DRIVE"
          ledId={Param.FX_DRIVE_ON}
          specs={[SPEC_BY_ID[Param.FX_DRIVE_AMT], SPEC_BY_ID[Param.FX_DRIVE_MIX]]}
        />
      </div>
    </ModuleShell>
  );
}

/** Render the module identified by a layout id. */
export function ModuleFor({ id }: { id: ModuleId }) {
  switch (id) {
    case 'osc1':
      return <OscModule which={1} />;
    case 'osc2':
      return <OscModule which={2} />;
    case 'filter':
      return <FilterModule />;
    case 'env':
      return <EnvModule />;
    case 'lfo':
      return <LfoModule />;
    case 'matrix':
      return <ModMatrix />;
    case 'fx':
      return <FxModule />;
    case 'fx2':
      return <Fx2Module />;
    default:
      return null;
  }
}
