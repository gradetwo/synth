import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import {
  DELAY_SYNCS,
  LFO_TARGETS,
  LFO_WAVES,
  MOD_DESTS,
  MOD_SOURCES,
  Param,
  SPEC_BY_ID,
  WAVES,
  filterToInt,
  intToDelaySync,
  intToFilter,
  intToModDst,
  intToModSrc,
  modDstToInt,
  modSrcToInt,
  type Wave,
} from '@/audio/params';
import { Knob, Led, ParamLed, Segment, WaveSelect } from '@/components/controls';
import { FilterCurve, LfoRateLabel, MiniWave } from '@/components/canvas';
import { AdsrEditor } from '@/components/AdsrEditor';

function Screws() {
  return (
    <>
      <span className="screw tl" />
      <span className="screw tr" />
      <span className="screw bl" />
      <span className="screw br" />
    </>
  );
}

function ModuleHead({
  title,
  sub,
  ledId,
}: {
  title: string;
  sub: string;
  ledId?: number;
}) {
  return (
    <div className="module-head">
      <span className="bar" />
      <span className="title">{title}</span>
      <span className="sub">{sub}</span>
      <span className="spacer" />
      {ledId !== undefined ? <ParamLed id={ledId} label={`${title} 开关`} /> : null}
    </div>
  );
}

function ParamWaveSelect({ id, waves }: { id: number; waves: Wave[] }) {
  useSynth();
  return (
    <WaveSelect
      value={Math.round(store.getParam(id as never))}
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
  useSynth();
  return (
    <Segment
      value={Math.round(store.getParam(id as never))}
      options={options}
      colorful={colorful}
      label={label}
      onChange={(v) => store.setParam(id as never, v, { immediate: true })}
    />
  );
}

// --------------------------------------------------------------------- OSC

export function OscModule({ which }: { which: 1 | 2 }) {
  const color = which === 1 ? 'var(--osc1)' : 'var(--osc2)';
  const pitch = SPEC_BY_ID[which === 1 ? Param.OSC1_PITCH : Param.OSC2_PITCH];
  const detune = SPEC_BY_ID[which === 1 ? Param.OSC1_DETUNE : Param.OSC2_DETUNE];
  const level = SPEC_BY_ID[which === 1 ? Param.OSC1_LEVEL : Param.OSC2_LEVEL];
  const pw = SPEC_BY_ID[which === 1 ? Param.OSC1_PW : Param.OSC2_PW];
  return (
    <div className="module" style={{ ['--mc' as string]: color }}>
      <Screws />
      <ModuleHead title={`OSC ${which}`} sub={which === 1 ? '振荡器 A' : '振荡器 B'} ledId={which === 1 ? 1 : 7} />
      <ParamWaveSelect id={which === 1 ? Param.OSC1_WAVE : Param.OSC2_WAVE} waves={WAVES} />
      <div className="knob-row">
        <Knob spec={pitch} />
        <Knob spec={detune} />
        <Knob spec={level} />
        <Knob spec={pw} />
      </div>
      <MiniWave which={which} color={which === 1 ? '#4da3ff' : '#35d0c5'} />
      <div className="mini-label">WAVE PREVIEW</div>
    </div>
  );
}

// ------------------------------------------------------------------ FILTER

export function FilterModule() {
  useSynth();
  const type = intToFilter(store.getParam(Param.FILTER_TYPE));
  return (
    <div className="module" style={{ ['--mc' as string]: 'var(--filter)' }}>
      <Screws />
      <ModuleHead title="FILTER" sub="滤波器" />
      <ParamSegment
        id={Param.FILTER_TYPE}
        colorful
        label="滤波器类型"
        options={[
          { label: 'LP', value: filterToInt('lp'), title: '低通 · Moog 阶梯' },
          { label: 'HP', value: filterToInt('hp'), title: '高通' },
          { label: 'BP', value: filterToInt('bp'), title: '带通' },
          { label: 'NT', value: filterToInt('nt'), title: '陷波' },
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
            <ParamLed id={Param.FILTER_KBD} label="键盘跟踪" />
          </div>
        </div>
      </div>
      <FilterCurve />
      <div className="mini-label">
        FREQ RESPONSE · {type === 'lp' ? '-24dB/OCT' : '-12dB/OCT'}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- ENV

export function EnvModule() {
  return (
    <div className="module" style={{ ['--mc' as string]: 'var(--env)' }}>
      <Screws />
      <ModuleHead title="AMP ENV" sub="振幅包络" />
      <AdsrEditor />
    </div>
  );
}

// --------------------------------------------------------------------- LFO

export function LfoModule() {
  return (
    <div className="module" style={{ ['--mc' as string]: 'var(--lfo)' }}>
      <Screws />
      <ModuleHead title="LFO" sub="低频振荡" ledId={Param.LFO_ON} />
      <ParamWaveSelect id={Param.LFO_WAVE} waves={LFO_WAVES} />
      <div className="knob-row">
        <Knob spec={SPEC_BY_ID[Param.LFO_RATE]} />
        <Knob spec={SPEC_BY_ID[Param.LFO_DEPTH]} />
      </div>
      <ParamSegment
        id={Param.LFO_TARGET}
        label="LFO 目标"
        options={LFO_TARGETS.map((t, i) => ({ label: t.toUpperCase(), value: i }))}
      />
      <div className="lfo-foot">
        <MiniWave which={1} color="#fb923c" lfo />
        <ParamLed id={Param.LFO_SYNC} label="LFO 同步" />
        <span className="hint">SYNC</span>
        <LfoRateLabel />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- MOD MATRIX

export function ModMatrix() {
  const { state } = useSynth();
  return (
    <div className="module" style={{ ['--mc' as string]: 'var(--matrix)' }}>
      <Screws />
      <ModuleHead title="MOD MATRIX" sub="调制路由" />
      <div className="matrix-list">
        {state.routes.map((route, i) => (
          <div className="mrow" key={i}>
            <select
              className="badge badge-sel"
              style={{ color: 'var(--lfo)' }}
              value={modSrcToInt(route.src)}
              onChange={(e) => store.setRoute(i, { src: intToModSrc(Number(e.target.value)) })}
              aria-label="调制源"
            >
              {MOD_SOURCES.map((s, si) => (
                <option key={s} value={si}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            <span className="arrow">─▶</span>
            <select
              className="badge badge-sel"
              value={modDstToInt(route.dst)}
              onChange={(e) => store.setRoute(i, { dst: intToModDst(Number(e.target.value)) })}
              aria-label="调制目标"
            >
              {MOD_DESTS.map((d, di) => (
                <option key={d} value={di}>
                  {d.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              type="range"
              className="mod-range"
              min={0}
              max={1}
              step={0.01}
              value={route.amount}
              style={{ ['--p' as string]: `${route.amount * 100}%` }}
              onChange={(e) => store.setRoute(i, { amount: Number(e.target.value) })}
              aria-label="调制量"
            />
            <Led
              on={route.enabled}
              onToggle={(v) => store.setRoute(i, { enabled: v })}
              label="启用路由"
              color="var(--matrix)"
            />
            <button type="button" className="route-del" title="删除路由" onClick={() => store.removeRoute(i)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add-route" onClick={() => store.addRoute()}>
        ＋ 添加调制路由
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------- FX

export function FxModule() {
  useSynth();
  const sync = intToDelaySync(store.getParam(Param.FX_DELAY_SYNC));
  return (
    <div className="module fx" style={{ ['--mc' as string]: 'var(--fx)' }}>
      <Screws />
      <ModuleHead title="FX" sub="效果处理" />
      <div className="fx-grid">
        <div className="fx-unit">
          <div className="fx-title">
            <ParamLed id={Param.FX_REVERB_ON} label="混响开关" />
            REVERB
          </div>
          <div className="knob-row">
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_SIZE]} />
            <Knob spec={SPEC_BY_ID[Param.FX_REVERB_MIX]} />
          </div>
        </div>
        <div className="fx-sep" />
        <div className="fx-unit">
          <div className="fx-title">
            <ParamLed id={Param.FX_DELAY_ON} label="延迟开关" />
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
          </div>
        </div>
      </div>
    </div>
  );
}
