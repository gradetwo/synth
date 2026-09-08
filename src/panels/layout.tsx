import { useEffect, useRef, useState } from 'react';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { noteBus, noteName, noteToHz } from '@/audio/noteBus';
import { LfoLed, LfoRateLabel, Scope, ScopeMeta, Spectrum, VuMeter } from '@/components/canvas';
import { Keyboard, Wheels } from '@/components/Keyboard';
import { toast } from '@/components/Toast';
import type { EngineStatus } from '@/audio/engine';

// ---------------------------------------------------------------- top bar

function EngineBadge({ status }: { status: EngineStatus }) {
  const label =
    status === 'running'
      ? 'ONLINE'
      : status === 'loading'
        ? 'LOADING'
        : status === 'suspended'
          ? 'SUSPENDED'
          : status === 'error'
            ? 'ERROR'
            : 'STANDBY';
  return <span className={`engine-badge ${status}`}>{label}</span>;
}

export function TopBar({ onBrowse, status }: { onBrowse: () => void; status: EngineStatus }) {
  const { currentPresetId, state } = useSynth();
  const preset = store.allPresets().find((p) => p.id === currentPresetId);
  const power = state.power;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" stroke="#3a4152" />
            <path d="M4.5 12 Q7.5 5 12 12 T19.5 12" stroke="#ffb340" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">
            GROOVE <b>SYNTH</b>
          </div>
          <div className="brand-sub">GS-1 · WEB POLYPHONIC SYNTH</div>
        </div>
        <button
          type="button"
          className="power-btn"
          title="电源开关"
          aria-label="电源开关"
          aria-pressed={power}
          onClick={() => store.setPower(!power)}
        >
          <span className={`pled${power ? ' on' : ''}`} />
        </button>
        <EngineBadge status={status} />
      </div>

      <div className="preset-ctrl">
        <button type="button" className="nav-btn" title="上一个预设" aria-label="上一个预设" onClick={() => store.stepPreset(-1)}>
          ‹
        </button>
        <div
          className="preset-display"
          role="button"
          tabIndex={0}
          title="点击打开预设库"
          onClick={onBrowse}
          onKeyDown={(e) => (e.key === 'Enter' ? onBrowse() : undefined)}
        >
          <div>
            <span className="preset-tag">{preset?.tag ?? 'INIT'}</span>
          </div>
          <div className="preset-name">{preset?.name ?? 'INIT · 初始正弦'}</div>
        </div>
        <button type="button" className="nav-btn" title="下一个预设" aria-label="下一个预设" onClick={() => store.stepPreset(1)}>
          ›
        </button>
      </div>

      <div className="top-actions">
        <button
          type="button"
          className="tbtn"
          title="随机生成新音色"
          onClick={() => {
            store.randomize();
            toast('已随机生成新音色 · <b>RANDOM</b>');
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          随机
        </button>
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            const p = store.savePreset();
            toast(`已保存到预设库 · <b>${p.name.split(' · ')[0]}</b>`);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          保存
        </button>
        <button type="button" className="tbtn primary" onClick={onBrowse}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          预设库
        </button>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------- monitor

function NoteDisplay() {
  const [info, setInfo] = useState({ note: null as number | null, velocity: 1, voices: 0 });
  useEffect(() => noteBus.subscribe(setInfo), []);
  return (
    <div className="note-display">
      <span className="nd-label">NOTE</span>
      <span className="nd-val">{info.note === null ? '—' : noteName(info.note)}</span>
      <span className="nd-sub">
        {info.note === null ? '0.0 Hz' : `${noteToHz(info.note).toFixed(1)} Hz`}
        {info.voices > 1 ? ` · ${info.voices} VOICES` : ''}
      </span>
    </div>
  );
}

const ARP = [60, 63, 65, 67, 70, 72, 70, 67];

function DemoButton() {
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);
  const step = useRef(0);

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
    noteBus.allOff();
  };

  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className={`demo-btn${running ? ' running' : ''}`}
      onClick={() => {
        if (running) {
          stop();
          return;
        }
        if (!store.getSnapshot().state.power) return;
        setRunning(true);
        step.current = 0;
        const tick = () => {
          const note = ARP[step.current % ARP.length];
          step.current += 1;
          noteBus.noteOn(note, 0.9);
          window.setTimeout(() => noteBus.noteOff(note), 210);
        };
        tick();
        timer.current = window.setInterval(tick, 300);
      }}
    >
      {running ? '■ STOP' : '▶ DEMO 琶音'}
    </button>
  );
}

export function DisplayRow() {
  return (
    <section className="display-row">
      <div className="panel scope-panel">
        <div className="panel-head">
          <span className="ph-title">SCOPE · 时域波形</span>
          <ScopeMeta />
        </div>
        <div className="scope-body">
          <Scope />
        </div>
      </div>

      <div className="panel spectrum-panel">
        <div className="panel-head">
          <span className="ph-title">SPECTRUM · 频谱</span>
          <span className="ph-meta">36 BINS · PEAK HOLD</span>
        </div>
        <div className="spec-body">
          <Spectrum />
        </div>
      </div>

      <div className="panel monitor-panel">
        <div className="panel-head">
          <span className="ph-title">MONITOR · 监视</span>
        </div>
        <DemoButton />
        <div className="monitor-body">
          <NoteDisplay />
          <VuMeter />
          <div className="lfo-mon">
            <span className="lm-label">LFO</span>
            <LfoLed />
            <LfoRateLabel />
          </div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- keyboard bar

export function KeyboardBar() {
  return (
    <footer className="kbd-bar">
      <Wheels />
      <Keyboard />
      <div className="kbd-tips">
        <div>◈ <b>点击/滑奏琴键</b> 触发包络与示波器</div>
        <div>◈ <b>拖动旋钮</b> 上下调节 · <b>双击</b> 复位</div>
        <div>◈ <b>Shift+拖动</b> 微调 · 滚轮同样可用</div>
        <div>◈ <b>拖动 ADSR 手柄</b> 编辑包络曲线</div>
      </div>
    </footer>
  );
}
