/**
 * The song library's own copy (P10.5).
 *
 * The player panel shows a source/licence label on every row and reports why an
 * import was refused, so that copy lives with the library rather than with the
 * shared panel table: `src/i18n-panels.ts` is edited by another track, and the
 * parallel-dev protocol gives each UI batch its own module so two of them can
 * add keys without touching the same file.
 *
 * The pattern is the one `i18n-panels.ts` uses: a table plus a `once()` loader,
 * registered by `loadAllStrings()`. Nothing here is in the entry chunk — the
 * module is reached by `import()` (and, for determinism, directly by the player
 * panel), so it costs the first screen nothing.
 */
import { registerStrings, type StringTable } from './i18n';

export const LIBRARY_STRINGS: StringTable = {
  // --- licence / provenance, shown on every built-in row -------------------
  'lib.source.publicDomain': ['公版作品', 'Public domain'],
  'lib.source.original': ['原创作品', 'Original work'],
  'lib.source.user': ['用户导入', 'User track'],
  'lib.sourceHint': ['来源与许可', 'Source and licence'],
  'lib.copyright': [
    '内置曲目均为公版作品或本站原创编配，并逐首标注来源与许可。',
    'Every built-in is a public-domain work or an original arrangement, labelled with its source and licence.',
  ],

  // --- importing ----------------------------------------------------------
  'lib.import': ['导入曲目', 'Import track'],
  'lib.importFailed': ['导入失败：{msg}', 'Import failed: {msg}'],
  'lib.importBadJson': ['文件不是有效的 JSON', 'the file is not valid JSON'],
  'lib.importUnknownFormat': [
    '无法识别的文件格式（支持 .mid / .midi / .gs1song）',
    'unrecognised file format (supported: .mid / .midi / .gs1song)',
  ],
  'lib.importNotASong': ['这是音色文件，不含曲目', 'that is a patch file with no song in it'],
  'lib.importDamagedSong': [
    '曲目数据已损坏，无法还原',
    'the arrangement is damaged and could not be restored',
  ],
};

/** Register once; a second call is free (same shape as `i18n-panels.ts`). */
function once(load: () => void): () => Promise<void> {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      load();
    }
    return Promise.resolve();
  };
}

export const loadLibraryStrings = once(() => registerStrings(LIBRARY_STRINGS));
