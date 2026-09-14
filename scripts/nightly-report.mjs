#!/usr/bin/env node
/**
 * The nightly *record*: the run table in `docs/notes/nightly.md`, the pass-rate
 * trend under it, and the self-test that keeps both honest.
 *
 * This is separate from `nightly-e2e.mjs` because the parts that can be wrong —
 * which column holds which number, what a legacy row (written before the
 * `显示` column existed) means, how the trend is averaged — must be checkable
 * without launching a browser. `--self-test` runs the parser, the row writer and
 * the trend renderer over fixtures, and then over the real
 * `docs/notes/nightly.md`: the file in the repo has to be *exactly* what this
 * script would write, so a hand-edited (and therefore stale) trend cannot pass
 * as a generated one.
 *
 *   node scripts/nightly-report.mjs --self-test   # gates this file
 *   node scripts/nightly-report.mjs --render      # rewrite table + trend from what the table has
 *
 * `nightly-e2e.mjs --update` calls `updateNotes()`; that is the only way a row
 * is ever appended, so the trend is always recomputed from the same table the
 * reader sees.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTES_PATH = resolve(root, 'docs', 'notes', 'nightly.md');

export const COLUMNS = ['日期', '内核', '显示', '结果', '通过', '失败', '通过率', '用时'];
export const TABLE_HEADER = `| ${COLUMNS.join(' | ')} |`;
export const TABLE_SEPARATOR = '| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: |';
/** Rows written before the `显示`/`通过率` columns existed carry this in `显示`. */
export const NO_DISPLAY = '—';
/** A run with nothing to judge (browser never started, 0 cases collected). */
export const NO_RATE = '—';
export const TREND_START = '<!-- nightly-trend:start -->';
export const TREND_END = '<!-- nightly-trend:end -->';
export const TREND_WINDOW = 5;
const RATE_DECIMALS = 1;

/** 通过率 from the two counts the run actually reported. `null` = nothing to judge. */
export function rate(passed, failed) {
  if (!Number.isFinite(passed) || !Number.isFinite(failed) || passed + failed === 0) return null;
  return (100 * passed) / (passed + failed);
}

const asRate = (value) => (value === null ? NO_RATE : `${value.toFixed(RATE_DECIMALS)}%`);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/** `1.2 pp` with an explicit sign, so `+0.0` and `−0.0` are never confused. */
function signed(before, after) {
  const delta = after - before;
  if (delta === 0) return '±0.0 pp';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(RATE_DECIMALS)} pp`;
}

/**
 * The rows of the run table, in the order they were written.
 *
 * Two shapes are accepted: the current eight columns, and the six-column rows
 * written before `显示`/`通过率` existed. Anything else is an error rather than
 * a guess — mis-reading a column is how a record starts lying.
 */
export function parseRuns(markdown) {
  const runs = [];
  const lines = markdown.split('\n');
  // Only the run table, found by its `日期` header: the trend table below it is
  // also a markdown table and must not be read as runs.
  const start = lines.findIndex((line) => line.startsWith('|') && line.includes(COLUMNS[0]));
  if (start < 0) throw new Error(`the run table is missing (no line starts with "| ${COLUMNS[0]}")`);
  for (let i = start; i < lines.length && lines[i].startsWith('|'); i++) {
    const line = lines[i];
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === COLUMNS[0]) continue; // header
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue; // separator
    let run;
    if (cells.length === 6) {
      const [date, engine, result, passed, failed, seconds] = cells;
      run = { date, engine, display: NO_DISPLAY, result, passed, failed, seconds, legacy: true };
    } else if (cells.length === 8) {
      const [date, engine, display, result, passed, failed, , seconds] = cells;
      run = { date, engine, display, result, passed, failed, seconds, legacy: false };
    } else {
      throw new Error(`run row has ${cells.length} cells, expected 6 (legacy) or 8: ${line}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(run.date)) throw new Error(`run row has no date: ${line}`);
    run.passed = Number(run.passed);
    run.failed = Number(run.failed);
    if (!Number.isInteger(run.passed) || !Number.isInteger(run.failed)) {
      throw new Error(`run row has non-numeric pass/fail counts: ${line}`);
    }
    if (!/^\d+s$/.test(run.seconds)) throw new Error(`run row has no seconds: ${line}`);
    run.seconds = Number(run.seconds.slice(0, -1));
    // The 通过率 column is written from the counts, never read back.
    run.passRate = rate(run.passed, run.failed);
    runs.push(run);
  }
  return runs;
}

export function formatRow(run) {
  return (
    `| ${run.date} | ${run.engine} | ${run.display} | ${run.result} | ${run.passed} | ` +
    `${run.failed} | ${asRate(rate(run.passed, run.failed))} | ${run.seconds}s |`
  );
}

export function renderTable(runs) {
  return [TABLE_HEADER, TABLE_SEPARATOR, ...runs.map(formatRow)].join('\n');
}

/**
 * A run reads as a pass-rate trend per engine: the last `window` rates, their
 * mean, and the change since the previous run. A single run has no trend, and
 * says so with `—` rather than inventing one. The display path is deliberately
 * *not* part of the grouping: it is recorded per row, but a run is a run.
 */
export function renderTrend(runs, { window = TREND_WINDOW } = {}) {
  const engines = [...new Set(runs.map((run) => run.engine))].sort();
  const rows = engines.map((engine) => {
    const all = runs.filter((run) => run.engine === engine);
    // Rates are always recomputed from the counts, so a stale (or absent)
    // 通过率 cell can never drive the trend.
    const rates = all.map((run) => rate(run.passed, run.failed)).filter((value) => value !== null);
    const series = rates.slice(-window);
    const latest = rates.length ? rates[rates.length - 1] : null;
    const previous = rates.length >= 2 ? rates[rates.length - 2] : null;
    const change = previous === null || latest === null ? NO_RATE : signed(previous, latest);
    return `| ${engine} | ${all.length} | ${series.length ? series.map(asRate).join(' → ') : NO_RATE} | ${
      series.length ? asRate(mean(series)) : NO_RATE
    } | ${change} |`;
  });

  const passed = runs.reduce((total, run) => total + run.passed, 0);
  const failed = runs.reduce((total, run) => total + run.failed, 0);
  const overall = rate(passed, failed);
  const totals = runs.length
    ? `全期合计：${passed} passed / ${failed} failed = ${asRate(overall)}` +
      `（${runs.length} 次运行，${engines.length} 个内核）。`
    : '全期合计：还没有记录。';

  return [
    TREND_START,
    '## 通过率趋势 / Pass-rate trend（脚本生成，勿手改）',
    '',
    '由 `node scripts/nightly-report.mjs --render`（或 `npm run nightly -- --update`）从上面的表重算。',
    `通过率 = 通过 / (通过 + 失败)；\`${NO_RATE}\` 表示该次没有可判定的用例（浏览器没起来、收集到 0 个用例）。`,
    `\`变化\` = 最近一次通过率 − 上一次通过率（单位：个百分点），只有一次记录时为 \`${NO_RATE}\`。`,
    '`显示` 会影响耗时与稳定性，跨显示的通过率比较只是近似；判据仍然是「同显示下的纵向变化」。',
    '',
    `| 内核 | 记录数 | 最近 ${window} 次通过率（旧 → 新） | 最近 ${window} 次均值 | 变化（最近一次 − 上一次） |`,
    '| :--- | ---: | :--- | ---: | ---: |',
    ...rows,
    '',
    totals,
    TREND_END,
  ].join('\n');
}

/**
 * Replace the run table, keeping every line around it (the prose above, the
 * note below) exactly as the reader left it.
 */
export function spliceTable(markdown, runs) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('|') && line.includes(COLUMNS[0]));
  if (start < 0) throw new Error('the run table is missing (no line starts with "| 日期")');
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].startsWith('|')) end += 1;
  lines.splice(start, end - start + 1, ...renderTable(runs).split('\n'));
  return lines.join('\n');
}

/** Replace the generated block between the markers, or append it if absent. */
export function spliceTrend(markdown, runs) {
  const block = renderTrend(runs);
  const start = markdown.indexOf(TREND_START);
  const end = markdown.indexOf(TREND_END);
  if (start < 0 || end < 0) return `${markdown.replace(/\n*$/, '')}\n\n${block}\n`;
  return markdown.slice(0, start) + block + markdown.slice(end + TREND_END.length);
}

/** The whole record: table rows then the recomputed trend. Idempotent. */
export function updateNotes(markdown, runs) {
  return spliceTrend(spliceTable(markdown, runs), runs);
}

/**
 * The one write path: read the record (or start one on a fresh checkout),
 * append this run's rows, write it back, and return every row. `nightly-e2e.mjs`
 * calls exactly this, so the wiring the self-test covers is the wiring that runs.
 */
export function appendRuns(notesPath, rows) {
  const onDisk = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : newNotes([]);
  const runs = [...parseRuns(onDisk), ...rows];
  writeFileSync(notesPath, updateNotes(onDisk, runs));
  return runs;
}

/** What a fresh checkout gets: prose, then the same generated body. */
export function newNotes(runs) {
  const prose = [
    '# 夜间浏览器跑 / Nightly browser runs',
    '',
    '由 `npm run nightly -- --update`（本机 / systemd 定时器）写入。CI 的 `nightly` 作业跑同一套',
    '子集但不写这张表：它的工作区是一次性的，写不进仓库。',
    '',
    '怎么读这张表：**Chromium 是门禁**（必须全绿）；**WebKit / Firefox 是报告**。本机 WebKit 只有约 1 fps',
    '（见 `docs/notes/compat.md`），所以本机默认子集是「核心 + 视觉冒烟 + 音频」三块，跑完通常要一两小时；',
    '`--core` 只跑核心子集，`--all` 跑全量。全量与判据都在 CI。',
    '',
    '| 日期 | 内核 | 显示 | 结果 | 通过 | 失败 | 通过率 | 用时 |',
    '| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: |',
  ].join('\n');
  return `${updateNotes(prose, runs)}\n`;
}

/** A note the reader needs to interpret the legacy rows honestly. */
export const LEGACY_NOTE = [
  `> \`显示\` 与 \`通过率\` 两列从 v2.0.1（P11.6）起记录。写在这两列存在之前的行，\`显示\` 记 \`${NO_DISPLAY}\`：`,
  '> 当时用的是哪条显示路径已无从回填，不猜。它们的 `通过率` 是对该行已有的「通过 / 失败」做算术，不是新测的数字。',
].join('\n');

// ---------------------------------------------------------------------------
// The self-test. Fixtures first, then the real file.
// ---------------------------------------------------------------------------

const LEGACY_TABLE = [
  '| 日期 | 内核 | 结果 | 通过 | 失败 | 用时 |',
  '| :--- | :--- | :--- | ---: | ---: | ---: |',
  '| 2026-09-11 | chromium | ✅ pass | 25 | 0 | 196s |',
  '| 2026-09-11 | webkit | ❌ fail | 18 | 7 | 2459s |',
].join('\n');

const NEW_ROW = {
  date: '2026-09-14',
  engine: 'webkit',
  display: 'weston',
  result: '❌ fail',
  passed: 40,
  failed: 10,
  seconds: 900,
};

function selfTest() {
  const checks = [];
  const check = (name, fn) => {
    fn();
    checks.push(name);
  };

  check('a legacy row parses, and its display is "—" (not guessed)', () => {
    const runs = parseRuns(LEGACY_TABLE);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].display, NO_DISPLAY);
    assert.equal(runs[0].legacy, true);
    assert.equal(runs[1].engine, 'webkit');
    assert.equal(runs[1].passRate, 72);
    assert.equal(runs[1].seconds, 2459);
  });

  check('a current row round-trips through formatRow', () => {
    const row = formatRow({ ...NEW_ROW, passRate: rate(NEW_ROW.passed, NEW_ROW.failed) });
    const [run] = parseRuns(`${TABLE_HEADER}\n${TABLE_SEPARATOR}\n${row}`);
    assert.equal(run.display, 'weston');
    assert.equal(run.passRate, 80);
    assert.equal(formatRow(run), row);
  });

  check('通过率 comes from the counts, not from the column text', () => {
    const row = '| 2026-09-14 | webkit | weston | ✅ pass | 3 | 1 | 99.9% | 60s |';
    const [run] = parseRuns(`${TABLE_HEADER}\n${TABLE_SEPARATOR}\n${row}`);
    assert.equal(run.passRate, 75);
  });

  check('0/0 means "nothing to judge", not 0%', () => {
    assert.equal(rate(0, 0), null);
    assert.equal(asRate(rate(0, 0)), NO_RATE);
    assert.equal(rate(4, 0), 100);
  });

  check('a malformed row is an error, never a guess', () => {
    assert.throws(
      () => parseRuns(`${TABLE_HEADER}\n${TABLE_SEPARATOR}\n| 2026-09-14 | webkit | weston | 1 | 2 |`),
      /cells/,
    );
    assert.throws(
      () => parseRuns(`${TABLE_HEADER}\n${TABLE_SEPARATOR}\n| not-a-date | webkit | headless | ✅ pass | 1 | 0 | 100.0% | 1s |`),
      /date/,
    );
    assert.throws(() => parseRuns('no table here'), /run table is missing/);
  });

  check('the trend uses the last 5 runs and the change since the previous one', () => {
    const runs = Array.from({ length: 7 }, (_, i) => ({
      date: '2026-09-14',
      engine: 'webkit',
      display: 'weston',
      result: '✅ pass',
      passed: 1 + i,
      failed: 9 - i,
      seconds: 10,
      passRate: rate(1 + i, 9 - i),
    }));
    const block = renderTrend(runs);
    const row = block.split('\n').find((line) => line.startsWith('| webkit |'));
    assert.ok(row, 'the engine has a trend row');
    assert.equal(row, '| webkit | 7 | 30.0% → 40.0% → 50.0% → 60.0% → 70.0% | 50.0% | +10.0 pp |');
    assert.match(block, /全期合计：28 passed \/ 42 failed = 40\.0%（7 次运行，1 个内核）。/);
  });

  check('one run has no trend, and says so', () => {
    const block = renderTrend([{ ...NEW_ROW, passRate: 80 }]);
    assert.match(block, /\| webkit \| 1 \| 80\.0% \| 80\.0% \| — \|/);
  });

  check('updating a legacy file adds the columns and keeps the prose', () => {
    const before = `# t\n\nprose line\n\n${LEGACY_TABLE}\n\n${LEGACY_NOTE}\n\n${renderTrend(parseRuns(LEGACY_TABLE))}\n`;
    const runs = parseRuns(LEGACY_TABLE);
    const after = updateNotes(before, runs);
    assert.match(after, /prose line/);
    assert.match(after, /LEGACY|显示/);
    assert.match(after, /\| 2026-09-11 \| chromium \| — \| ✅ pass \| 25 \| 0 \| 100\.0% \| 196s \|/);
    assert.match(after, /\| 2026-09-11 \| webkit \| — \| ❌ fail \| 18 \| 7 \| 72\.0% \| 2459s \|/);
    assert.equal(after, updateNotes(after, runs), 'idempotent');
  });

  check('appending a row grows the trend', () => {
    const runs = parseRuns(LEGACY_TABLE);
    const next = [...runs, { ...NEW_ROW, passRate: rate(NEW_ROW.passed, NEW_ROW.failed) }];
    const after = updateNotes(updateNotes(LEGACY_TABLE, runs), next);
    assert.match(after, /\| webkit \| 2 \| 72\.0% → 80\.0% \| 76\.0% \| \+8\.0 pp \|/);
  });

  check('a file without the trend block gets one, with the markers', () => {
    const after = updateNotes(`# t\n\n${LEGACY_TABLE}\n`, parseRuns(LEGACY_TABLE));
    assert.ok(after.includes(TREND_START) && after.includes(TREND_END));
    assert.ok(after.indexOf(TREND_START) > after.indexOf('| 2026-09-11'));
  });

  check('appendRuns is the write path the runner uses (fresh file, then a second run)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nightly-report-'));
    const path = join(dir, 'nightly.md');
    try {
      const first = appendRuns(path, [{ ...NEW_ROW, passRate: rate(NEW_ROW.passed, NEW_ROW.failed) }]);
      assert.equal(first.length, 1);
      const second = appendRuns(path, [
        { ...NEW_ROW, date: '2026-09-15', engine: 'firefox', passed: 50, failed: 0, display: 'headless' },
      ]);
      assert.equal(second.length, 2);
      const onDisk = readFileSync(path, 'utf8');
      assert.deepEqual(
        parseRuns(onDisk).map((run) => `${run.date}/${run.engine}/${run.display}`),
        ['2026-09-14/webkit/weston', '2026-09-15/firefox/headless'],
      );
      assert.match(onDisk, /\| webkit \| 1 \| 80\.0% \| 80\.0% \| — \|/);
      assert.equal(updateNotes(onDisk, second), onDisk, 'the written file is a fixed point');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  check('the checked-in docs/notes/nightly.md is exactly what the script writes', () => {
    const onDisk = readFileSync(NOTES_PATH, 'utf8');
    const runs = parseRuns(onDisk);
    assert.ok(runs.length > 0, 'the record has rows');
    assert.equal(updateNotes(onDisk, runs), onDisk, 'the table and the trend are in sync with the parser');
  });

  return checks;
}

// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    console.log('[nightly-report] self-test');
    const checks = selfTest();
    for (const name of checks) console.log(`  ✓ ${name}`);
    console.log(`[nightly-report] PASS — ${checks.length} checks`);
  } else if (args.includes('--render')) {
    const onDisk = readFileSync(NOTES_PATH, 'utf8');
    const runs = parseRuns(onDisk);
    writeFileSync(NOTES_PATH, updateNotes(onDisk, runs));
    console.log(`[nightly-report] re-rendered ${NOTES_PATH} from ${runs.length} rows`);
  } else {    console.error('usage: node scripts/nightly-report.mjs --self-test | --render');
    process.exit(2);
  }
}
