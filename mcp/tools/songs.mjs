/**
 * `gs1.songs.list` — the built-in demo playlist.
 *
 * Derived from `DEMO_SONGS` in `src/midi/songs.ts`: there is no second list of
 * titles or composers here, and the licence block travels with every row
 * because P10.5 made "why may this ship" part of the data. `title` is the
 * English name (the doc's flat shape) and `titleZh` the Chinese one, so a client
 * can render either without knowing the internal `[zh, en]` tuple.
 */
export default {
  name: 'gs1.songs.list',
  description:
    'List the built-in demo songs: id, bilingual title, composer and the licence provenance (kind + credit) each arrangement ships under.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (_args, ctx) => {
    const songs = ctx.data.DEMO_SONGS.map((song) => ({
      id: song.id,
      title: song.title[1],
      titleZh: song.title[0],
      composer: song.composer,
      source: {
        kind: song.source.kind,
        credit: song.source.credit,
        ...(song.source.url ? { url: song.source.url } : {}),
      },
      bpm: song.bpm,
      steps: song.steps.length,
    }));
    const sourceKinds = {};
    for (const song of songs) sourceKinds[song.source.kind] = (sourceKinds[song.source.kind] ?? 0) + 1;
    return { count: songs.length, sourceKinds, songs };
  },
};
