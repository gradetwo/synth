/**
 * Schema fragments shared by the tools that take a patch or a render.
 *
 * Keeping them here means `gs1.render`, `gs1.analyze` and `gs1.gate` publish the
 * same shape for the same concept, which is what lets an agent build one render
 * spec and point three tools at it.
 */

/** How a patch is named: a factory preset id, a share code, or a payload object. */
export const patchRef = {
  presetId: {
    type: 'string',
    minLength: 1,
    description: 'Factory preset id (see gs1.presets.list).',
  },
  patch: {
    type: ['string', 'object'],
    description:
      'A patch in the app\'s own format: a "gs1.1."/"gs1.2." share code, or the decoded payload { params, routes, params2?, instanceMode?, splitNote? }. Omit for the default patch.',
  },
};

/** `notes`, `seconds`, `oversample`, `sampleRate`, `seed` — the render spec. */
export const renderFields = {
  notes: {
    type: 'array',
    minItems: 1,
    maxItems: 4096,
    items: {
      type: 'object',
      required: ['note'],
      properties: {
        note: { type: 'integer', minimum: 0, maximum: 127 },
        velocity: { type: 'number', minimum: 0, maximum: 1 },
        start: { type: 'number', minimum: 0 },
        duration: { type: 'number', minimum: 0 },
      },
    },
    description:
      'At most 4096 notes; start/duration are seconds and are placed at 128-sample block boundaries. One of `notes`, `songId` or `midiBase64` — exactly one.',
  },
  songId: {
    type: 'string',
    minLength: 1,
    description:
      'A built-in song by id (see gs1.songs.list): rendered whole, with no note list to send. `seconds` defaults to the song plus a 0.5 s tail.',
  },
  midiBase64: {
    type: 'string',
    minLength: 1,
    description:
      'A standard MIDI file (SMF), base64-encoded and decoded by the app\'s own parser. The byte-cheap way to send a long arrangement; `seconds` defaults to the file plus a 0.5 s tail.',
  },
  seconds: {
    type: 'number',
    minimum: 0.05,
    maximum: 120,
    description:
      'Render length in seconds, at most 120. Long enough for a two-minute section; the renderer costs about 5.5x realtime on dense material at 2x oversampling, so this is also the per-call time budget.',
  },
  oversample: { type: ['integer', 'boolean'], enum: [0, 1, true, false] },
  sampleRate: { type: 'integer', enum: [48000], description: 'Only 48 kHz: the rulers are calibrated there.' },
  seed: {
    type: 'integer',
    minimum: 0,
    maximum: 512,
    description: 'Pins the oscillator start-phase/random sequence. Same seed ⇒ byte-identical output.',
  },
  outPath: {
    type: 'string',
    description: 'Where to write the WAV; must stay inside .tmp/mcp/ (default: a content-addressed name there).',
  },
};
