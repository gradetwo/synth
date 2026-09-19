#!/usr/bin/env node
/**
 * The frame-addressed worklet host-protocol gate.
 *
 * `docs/notes/groove-host-protocol.md` is the contract an external host (Groove Lab, any
 * lookahead scheduler) reads before it can drive this engine sample-accurately. A contract that
 * drifts from `src/audio/worklet-processor.js` is worse than no contract: the host keeps posting
 * a message name the processor no longer has, or reads a latency field the `ready` message no
 * longer sends, and the only symptom is silence or a systematically late groove.
 *
 * So this gate reads **the document and the source** and asserts both directions:
 *
 *   1. **Message names.** Every `host→worklet` message named in the contract's message table
 *      exists as a `case '…'` in `handleMessage`; every frame-addressed message the processor
 *      implements (`noteAt` / `noteOnAt` / `noteOffAt`) is named in the table.
 *   2. **Fields.** The frame-addressed table's field set equals the `data.*` fields the
 *      frame-addressed branch actually reads, and the `ready` row's field set equals the keys of
 *      the `ready` `postMessage` object — so a genuine field rename (in either place) is a
 *      failure rather than a silent `undefined`.
 *   3. **Constants.** `MAX_SCHEDULED_EVENTS` and `SCHEDULED_NOTE_LATENCY_FRAMES` are parsed out
 *      of the source and compared with the numbers in the contract's constants table. The
 *      document never becomes a second copy that can drift: change the constant and the gate
 *      stays red until the table says the new number.
 *
 * It also pins the structural anchors of the documented queue semantics (bound enforced, panic
 * clears the queue, the frame cursor advances while muted, the render block is split at due
 * events). Those are *anchors* for the prose, not behaviour proofs — the behaviour itself is
 * pinned by `src/audio/worklet-processor.test.ts › frame-addressed note events`.
 *
 * **No wasm, no browser, no `dist/`.** It is a text gate over two files. Usage:
 *
 *   node scripts/verify-worklet-protocol.mjs                    # the repository's docs + source
 *   node scripts/verify-worklet-protocol.mjs --docs-root D      # a copy, for self-proofs
 *   node scripts/verify-worklet-protocol.mjs --source F         # a mutated copy, for self-proofs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The contract document, relative to `--docs-root` (default `docs/`). */
export const DOC_FILE = 'notes/groove-host-protocol.md';
/** The one implementation this contract describes. */
export const SOURCE_FILE = 'src/audio/worklet-processor.js';
/** The machine-readable section markers. Only what is between them is parsed. */
export const DOC_BEGIN = '<!-- verify-worklet-protocol:begin -->';
export const DOC_END = '<!-- verify-worklet-protocol:end -->';
/** The direction token used by the message table. */
export const HOST_TO_WORKLET = 'host→worklet';
/** The reply message the host must wait for before posting anything. */
export const READY = 'ready';
/**
 * The constants the contract promises, with the source that owns them. Kept as an explicit list:
 * a constant nobody documents is exactly the drift this gate exists to catch.
 */
export const REQUIRED_CONSTANTS = ['MAX_SCHEDULED_EVENTS', 'SCHEDULED_NOTE_LATENCY_FRAMES'];

/** Arguments: `--docs-root <dir>`, `--source <file>`. */
function parseArgs(argv) {
  const options = {
    docsRoot: resolve(root, 'docs'),
    sourcePath: resolve(root, SOURCE_FILE),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--docs-root') options.docsRoot = resolve(argv[++i] ?? '.');
    else if (arg.startsWith('--docs-root=')) options.docsRoot = resolve(arg.slice('--docs-root='.length));
    else if (arg === '--source') options.sourcePath = resolve(argv[++i] ?? '.');
    else if (arg.startsWith('--source=')) options.sourcePath = resolve(arg.slice('--source='.length));
    else throw new Error(`unknown argument "${arg}"`);
  }
  return options;
}

const unbacktick = (cell) => cell.replace(/`/g, '').trim();
const identifiers = (cell) => [...unbacktick(cell).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);

/**
 * Parse the contract's machine-readable section into message rows and constants.
 *
 * Both tables are read structurally (header cells decide the column layout), so reordering
 * columns or adding rows needs no change here. Anything outside the begin/end markers is prose
 * and is deliberately not read.
 */
export function extractContract(docText) {
  const begin = docText.indexOf(DOC_BEGIN);
  const end = docText.indexOf(DOC_END);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${DOC_FILE}: missing the ${DOC_BEGIN} … ${DOC_END} machine-readable section`);
  }
  const section = docText.slice(begin + DOC_BEGIN.length, end);

  const messages = [];
  const constants = new Map();
  let mode = null;
  let columns = {};
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const plain = cells.map(unbacktick);
    // The `| :--- | :--- |` separator row carries no data.
    if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(unbacktick(c)))) continue;
    if (plain.includes('消息')) {
      mode = 'message';
      columns = {
        direction: plain.indexOf('方向'),
        message: plain.indexOf('消息'),
        fields: plain.indexOf('字段'),
      };
      if (columns.direction < 0 || columns.message < 0 || columns.fields < 0) {
        throw new Error(`${DOC_FILE}: the message table needs 方向 / 消息 / 字段 columns`);
      }
      continue;
    }
    if (plain.includes('常数')) {
      mode = 'constant';
      columns = { name: plain.indexOf('常数'), value: plain.indexOf('值') };
      if (columns.name < 0 || columns.value < 0) {
        throw new Error(`${DOC_FILE}: the constants table needs 常数 / 值 columns`);
      }
      continue;
    }
    if (mode === 'message') {
      messages.push({
        direction: plain[columns.direction],
        message: plain[columns.message],
        fields: identifiers(cells[columns.fields]),
      });
    } else if (mode === 'constant') {
      constants.set(plain[columns.name], plain[columns.value]);
    }
  }
  if (messages.length === 0 || constants.size === 0) {
    throw new Error(`${DOC_FILE}: the machine-readable section needs a message table and a constants table`);
  }
  return { messages, constants };
}

/** Pull the message names, field names and constants the processor actually implements. */
export function extractSource(source) {
  const handlerStart = source.indexOf('handleMessage(data) {');
  if (handlerStart < 0) throw new Error(`${SOURCE_FILE}: no handleMessage(data) { found`);
  const handlerEnd = source.indexOf('scheduleTimedNote(event) {', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd > handlerStart ? handlerEnd : undefined);

  // Every `case '…'` label in the message switch.
  const cases = new Set([...handler.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));

  // The frame-addressed group: the run of `case` labels ending at the opening brace after
  // `case 'noteAt':`. A rename inside the group shows up as a missing name here.
  const frameAt = handler.indexOf("case 'noteAt':");
  if (frameAt < 0) throw new Error(`${SOURCE_FILE}: handleMessage has no case 'noteAt':`);
  const groupHead = handler.slice(frameAt, handler.indexOf('{', frameAt));
  const frameMessages = [...groupHead.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]);
  const groupEnd = handler.indexOf("case 'allNotesOff':", frameAt);
  const groupBody = handler.slice(frameAt, groupEnd > frameAt ? groupEnd : undefined);
  const dataFields = new Set(
    [...groupBody.matchAll(/data\.([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((m) => m[1])
      .filter((field) => field !== 'type'),
  );

  // The `ready` handshake object, so a renamed reply field is a failure rather than `undefined`.
  const readyMatch = /port\.postMessage\(\{\s*type:\s*'ready',([\s\S]*?)\}\);/.exec(source);
  if (!readyMatch) throw new Error(`${SOURCE_FILE}: no ready postMessage found`);
  const readyFields = new Set([...readyMatch[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]));

  const constants = new Map();
  for (const name of REQUIRED_CONSTANTS) {
    const match = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`).exec(source);
    constants.set(name, match ? Number(match[1]) : null);
  }
  return { cases, frameMessages, dataFields, readyFields, constants };
}

const sorted = (values) => [...values].sort();
const missing = (haystack, needles) => sorted(needles).filter((v) => !haystack.has(v));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docPath = resolve(options.docsRoot, DOC_FILE);
  const docText = readFileSync(docPath, 'utf8');
  const source = readFileSync(options.sourcePath, 'utf8');

  const contract = extractContract(docText);
  const code = extractSource(source);

  const docMessages = new Set(contract.messages.map((m) => m.message));
  const hostMessages = new Set(
    contract.messages.filter((m) => m.direction === HOST_TO_WORKLET).map((m) => m.message),
  );
  const frameRows = contract.messages.filter(
    (m) => m.direction === HOST_TO_WORKLET && code.frameMessages.includes(m.message),
  );
  const docFrameFields = new Set(frameRows.flatMap((row) => row.fields));
  const readyRow = contract.messages.find((m) => m.direction !== HOST_TO_WORKLET && m.message === READY);

  const failures = [];
  const check = (name, ok, detail = '') => {
    if (!ok) failures.push(name);
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('[worklet-protocol] messages (document ↔ source)');
  const unknown = sorted(hostMessages).filter((name) => !code.cases.has(name));
  check('every host→worklet message in the doc is a case in handleMessage', unknown.length === 0,
    unknown.length ? `not a handled message: ${unknown.join(', ')}` : `${hostMessages.size} documented messages`);
  const undocumented = missing(docMessages, code.frameMessages);
  check('every frame-addressed message in the source is documented', undocumented.length === 0,
    undocumented.length ? `undocumented: ${undocumented.join(', ')}` : `${code.frameMessages.join(', ')} documented`);
  check('the ready handshake is documented', Boolean(readyRow),
    readyRow ? `${READY}: ${readyRow.fields.join(', ')}` : `${READY} has no row in the doc's message table`);

  console.log('[worklet-protocol] fields (document ↔ source)');
  const fieldsDiffer =
    docFrameFields.size !== code.dataFields.size
    || [...docFrameFields].some((field) => !code.dataFields.has(field));
  check('the frame-addressed fields in the doc match the ones the code reads', !fieldsDiffer,
    fieldsDiffer
      ? `doc ${sorted(docFrameFields).join(', ')} vs code ${sorted(code.dataFields).join(', ')}`
      : sorted(code.dataFields).join(', '));
  const readyDiffer = !readyRow
    || readyRow.fields.length !== code.readyFields.size
    || readyRow.fields.some((field) => !code.readyFields.has(field));
  check('the ready fields in the doc match the ones the code posts', !readyDiffer,
    readyDiffer
      ? `doc ${readyRow ? readyRow.fields.join(', ') : '(none)'} vs code ${sorted(code.readyFields).join(', ')}`
      : sorted(code.readyFields).join(', '));

  console.log('[worklet-protocol] constants (derived from the source)');
  for (const name of REQUIRED_CONSTANTS) {
    const inSource = code.constants.get(name);
    const inDoc = contract.constants.get(name);
    check(`the doc documents ${name} with the source's value`, inSource !== null && inDoc === String(inSource),
      inSource === null
        ? `${SOURCE_FILE} has no "const ${name} = <number>"`
        : `doc says ${inDoc ?? '(missing)'}, code says ${inSource}`);
  }
  check('the ready message reports SCHEDULED_NOTE_LATENCY_FRAMES rather than a literal',
    /scheduledNoteLatencyFrames:\s*SCHEDULED_NOTE_LATENCY_FRAMES\b/.test(source),
    /scheduledNoteLatencyFrames:\s*SCHEDULED_NOTE_LATENCY_FRAMES\b/.test(source)
      ? ''
      : 'ready must publish the constant, or the doc table and the runtime value can drift apart');

  console.log('[worklet-protocol] documented queue semantics still anchored in the source');
  const scheduleBody = source.slice(source.indexOf('scheduleTimedNote(event) {'));
  check('the queue bound is enforced where events are inserted',
    /queue\.length\s*>=\s*MAX_SCHEDULED_EVENTS/.test(scheduleBody.slice(0, 400)));
  check('panic / allNotesOff clear the queue',
    /this\.scheduledNotes\.length\s*=\s*0/.test(source));
  check('the frame cursor advances while muted',
    /this\.renderedFrames\s*\+=\s*frames/.test(source));
  check('the render block is split at the due event (not snapped to a block boundary)',
    /applyScheduledNotesUpTo\(blockStart \+ offset\)/.test(source)
    && /gs_process\(chunk\)/.test(source));

  console.log('[worklet-protocol] copy-pasteable client snippet');
  check('the doc carries a noteAt postMessage example',
    /port\.postMessage\(\{\s*type:\s*'noteAt'/.test(docText));

  if (failures.length) {
    console.error(`[worklet-protocol] FAIL — ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('[worklet-protocol] PASS');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`[worklet-protocol] fatal: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
