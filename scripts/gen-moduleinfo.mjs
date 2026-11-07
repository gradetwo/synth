#!/usr/bin/env node
/**
 * Generate the VST3 `moduleinfo.json` files for the GS1 plugin.
 *
 * The single source of truth is `crates/synth-vst3/src/lib.rs`: the plugin
 * name, vendor, URL, e-mail, version, VST3 class ID bytes and subcategories
 * are parsed out of it, so the JSON can never drift from the binary that
 * reports the same values through `IPluginFactory`.
 *
 * Two files are written because the class ID is platform-dependent. nih-plug
 * (`src/plugin/vst3.rs`, `swap_vst3_uid_byte_order`) reports the raw
 * `VST3_CLASS_ID` bytes on macOS/Linux but byte-swaps the first eight bytes
 * (GUID-style 4/2/2 regrouping) on Windows, "for project-compatibility", and
 * a host compares the `moduleinfo.json` CID against the CID the loaded
 * factory reports. One file cannot be right on both platforms, so the
 * Windows bundle carries its own file:
 *
 *   - `crates/synth-vst3/moduleinfo.json`         — macOS/Linux CID
 *   - `crates/synth-vst3/moduleinfo.windows.json` — Windows CID
 *
 * The remaining fields are taken from the framework the binary itself uses,
 * not invented: `SDKVersion` is nih-plug's `VST3_SDK_VERSION`
 * (`src/wrapper/vst3/factory.rs`), `ClassFlags` is `1 << 1`
 * (`kSimpleModeSupported`, same file), and the factory `Flags` is
 * `FactoryFlags::kUnicode` = 16 (same file; `create_factory_info` sets
 * nothing else). The field names and which of them are mandatory come from
 * Steinberg's `moduleinfoparser.cpp` (factory info: Vendor, URL, E-Mail,
 * Flags; class info: CID, Category, Name, Vendor, Version, SDKVersion,
 * ClassFlags, Cardinality; at least one class). `Category` is the literal
 * string nih-plug writes into `PClassInfo` (`"Audio Module Class"`).
 *
 * The file is placed in two locations inside each bundle (see
 * `scripts/package-vst3-all.sh`): the bundle root, next to `Contents/`,
 * and `Contents/Resources/moduleinfo.json`. Hosts disagree about which of
 * the two they read (the SDK's own tooling writes the root; Cubase's
 * migration scan has been observed reading `Contents/Resources/`), and the
 * two copies are byte-identical, so both are shipped rather than betting
 * the bundle on one reader.
 *
 * Usage:
 *   node scripts/gen-moduleinfo.mjs            # (re)write both files
 *   node scripts/gen-moduleinfo.mjs --check    # exit non-zero if either
 *                                              # committed file differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libPath = resolve(root, 'crates/synth-vst3/src/lib.rs');
const lib = readFileSync(libPath, 'utf8');

const strConst = (name) => {
  const m = new RegExp(`const ${name}: &'static str = "([^"]*)";`).exec(lib);
  if (!m) throw new Error(`gen-moduleinfo: ${name} not found in ${libPath}`);
  return m[1];
};

const cidMatch = /const VST3_CLASS_ID: \[u8; 16\] = \*b"([^"]{16})";/.exec(lib);
if (!cidMatch) throw new Error(`gen-moduleinfo: VST3_CLASS_ID not found in ${libPath}`);
const cidBytes = [...cidMatch[1]].map((c) => c.charCodeAt(0));
if (cidBytes.length !== 16) throw new Error('gen-moduleinfo: VST3_CLASS_ID is not 16 bytes');

const subcatMatch = /const VST3_SUBCATEGORIES: &'static \[Vst3SubCategory\] =\s*&\[([^\]]*)\];/.exec(lib);
if (!subcatMatch) throw new Error(`gen-moduleinfo: VST3_SUBCATEGORIES not found in ${libPath}`);
const subcategories = [...subcatMatch[1].matchAll(/Vst3SubCategory::(\w+)/g)].map((m) => m[1]);
if (subcategories.length === 0) throw new Error('gen-moduleinfo: no subcategories parsed');

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
// Windows byte order (nih-plug `swap_vst3_uid_byte_order`, Windows only):
// bytes 0..4 reversed, bytes 4..6 swapped, bytes 6..8 swapped, rest as-is.
const windowsBytes = [...cidBytes];
for (const [a, b] of [[0, 3], [1, 2], [4, 5], [6, 7]]) {
  [windowsBytes[a], windowsBytes[b]] = [windowsBytes[b], windowsBytes[a]];
}

const name = strConst('NAME');
const vendor = strConst('VENDOR');
const url = strConst('URL');
const email = strConst('EMAIL');
const version = strConst('VERSION');

// Framework facts, pinned to the nih-plug rev in crates/synth-vst3/Cargo.toml
// (see the header comment); change them only when that rev changes.
const SDK_VERSION = 'VST 3.6.14';
const CLASS_FLAGS = 2; // kSimpleModeSupported
const FACTORY_FLAGS = 16; // kUnicode

const build = (cid) => ({
  Classes: [
    {
      CID: cid,
      Cardinality: 'Many',
      Category: 'Audio Module Class',
      ClassFlags: CLASS_FLAGS,
      Name: name,
      Subcategories: subcategories,
      Vendor: vendor,
      Version: version,
      SDKVersion: SDK_VERSION,
      Description: 'GROOVE SYNTH GS-1 VST3 instrument plugin',
    },
  ],
  'Factory Info': {
    Flags: FACTORY_FLAGS,
    Vendor: vendor,
    URL: url,
    'E-Mail': email,
  },
  Name: name,
  Version: version,
});

const files = [
  [resolve(root, 'crates/synth-vst3/moduleinfo.json'), build(hex(cidBytes))],
  [resolve(root, 'crates/synth-vst3/moduleinfo.windows.json'), build(hex(windowsBytes))],
];

const check = process.argv.includes('--check');
let dirty = false;
for (const [path, doc] of files) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (check) {
    let current = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      // Missing file is a diff.
    }
    // Line endings are not content: a Windows checkout with
    // core.autocrlf=true turns the committed LF files into CRLF, and
    // that alone must not fail the check. Only \r\n is folded, so a
    // drifted CID or any other field change still differs and still
    // fails. (The .gitattributes pin is the primary fix; this is the
    // second line of defence for checkouts that ignore attributes.)
    if (current !== null) current = current.replace(/\r\n/g, '\n');
    if (current !== text) {
      console.error(`gen-moduleinfo: ${path} differs from lib.rs; run node scripts/gen-moduleinfo.mjs`);
      dirty = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`gen-moduleinfo: wrote ${path}`);
  }
}
if (check && !dirty) console.log('gen-moduleinfo: both moduleinfo files match lib.rs');
process.exit(check && dirty ? 1 : 0);
