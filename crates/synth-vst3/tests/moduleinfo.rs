//! moduleinfo.json: the committed files must agree with the plugin the
//! binary actually reports through `IPluginFactory`.
//!
//! The class ID is platform-dependent: nih-plug reports the raw
//! `VST3_CLASS_ID` bytes on macOS/Linux but byte-swaps the first eight
//! bytes (GUID-style 4/2/2 regrouping) on Windows
//! (`swap_vst3_uid_byte_order`). The two committed files therefore carry
//! different CIDs by design — `moduleinfo.json` (unix) and
//! `moduleinfo.windows.json` (Windows) — and the packaging script puts the
//! matching one in each bundle. These tests pin that, plus the framework
//! facts the generator copies from nih-plug (`VST 3.6.14`, class flags 2,
//! factory flags 16), against the live plugin constants, so a metadata
//! change in `src/lib.rs` fails here instead of shipping a stale file.
//!
//! The generator itself (`scripts/gen-moduleinfo.mjs --check`) is the other
//! half of the pin: it re-derives both files from `src/lib.rs` and fails on
//! any drift, including the CID math.

use nih_plug::prelude::{Plugin, Vst3Plugin};
use serde_json::Value;
use synth_vst3::Gs1;

fn hex(bytes: &[u8; 16]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// The Windows byte order, mirroring nih-plug's `swap_vst3_uid_byte_order`.
fn windows_bytes(raw: [u8; 16]) -> [u8; 16] {
    let mut uid = raw;
    uid[0] = raw[3];
    uid[1] = raw[2];
    uid[2] = raw[1];
    uid[3] = raw[0];
    uid[4] = raw[5];
    uid[5] = raw[4];
    uid[6] = raw[7];
    uid[7] = raw[6];
    uid
}

fn read_moduleinfo(name: &str) -> Value {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {path}: {e}"))
}

#[test]
fn moduleinfo_cids_match_the_plugin_on_each_platform() {
    let raw = <Gs1 as Vst3Plugin>::VST3_CLASS_ID;
    let unix = read_moduleinfo("moduleinfo.json");
    let windows = read_moduleinfo("moduleinfo.windows.json");

    // The unix file carries the raw bytes; the Windows file the swapped ones.
    assert_eq!(unix["Classes"][0]["CID"].as_str().unwrap(), hex(&raw));
    assert_eq!(
        windows["Classes"][0]["CID"].as_str().unwrap(),
        hex(&windows_bytes(raw))
    );
    // And the file for this host agrees with what the factory on this host
    // reports (on Linux/macOS PLATFORM == raw, on Windows it is swapped).
    let platform_hex = hex(&<Gs1 as Vst3Plugin>::PLATFORM_VST3_CLASS_ID);
    let host_file = if cfg!(target_os = "windows") {
        &windows
    } else {
        &unix
    };
    assert_eq!(
        host_file["Classes"][0]["CID"].as_str().unwrap(),
        platform_hex
    );

    // The two files are the same document apart from the CID.
    let mut unix_minus_cid = unix.clone();
    let mut windows_minus_cid = windows.clone();
    unix_minus_cid["Classes"][0]["CID"] = Value::Null;
    windows_minus_cid["Classes"][0]["CID"] = Value::Null;
    assert_eq!(unix_minus_cid, windows_minus_cid);
}

#[test]
fn moduleinfo_fields_match_the_plugin_metadata() {
    let json = read_moduleinfo("moduleinfo.json");

    assert_eq!(json["Name"].as_str().unwrap(), <Gs1 as Plugin>::NAME);
    assert_eq!(json["Version"].as_str().unwrap(), <Gs1 as Plugin>::VERSION);
    let classes = json["Classes"].as_array().unwrap();
    assert_eq!(classes.len(), 1);
    let class = &classes[0];

    // Required by Steinberg's moduleinfoparser: CID, Category, Name, Vendor,
    // Version, SDKVersion, ClassFlags, Cardinality — all present, and equal
    // to what the binary reports.
    let cid = class["CID"].as_str().unwrap();
    assert_eq!(cid.len(), 32);
    assert!(cid
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
    assert_eq!(class["Category"].as_str().unwrap(), "Audio Module Class");
    assert_eq!(class["Cardinality"].as_str().unwrap(), "Many");
    assert_eq!(class["Name"].as_str().unwrap(), <Gs1 as Plugin>::NAME);
    assert_eq!(class["Vendor"].as_str().unwrap(), <Gs1 as Plugin>::VENDOR);
    assert_eq!(class["Version"].as_str().unwrap(), <Gs1 as Plugin>::VERSION);
    // nih-plug's VST3_SDK_VERSION (src/wrapper/vst3/factory.rs), the same
    // string the factory puts in PClassInfo2/PClassInfoW.
    assert_eq!(class["SDKVersion"].as_str().unwrap(), "VST 3.6.14");
    // kSimpleModeSupported, as set by nih-plug's create_class_info_2.
    assert_eq!(class["ClassFlags"].as_i64().unwrap(), 2);
    let subcategories: Vec<&str> = <Gs1 as Vst3Plugin>::VST3_SUBCATEGORIES
        .iter()
        .map(|s| s.as_str())
        .collect();
    let json_subs: Vec<&str> = class["Subcategories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(json_subs, subcategories);

    // Factory info, also mandatory in the parser: Vendor, URL, E-Mail, Flags.
    let factory = &json["Factory Info"];
    assert_eq!(factory["Vendor"].as_str().unwrap(), <Gs1 as Plugin>::VENDOR);
    assert_eq!(factory["URL"].as_str().unwrap(), <Gs1 as Plugin>::URL);
    assert_eq!(factory["E-Mail"].as_str().unwrap(), <Gs1 as Plugin>::EMAIL);
    // FactoryFlags::kUnicode only, as set by nih-plug's create_factory_info.
    assert_eq!(factory["Flags"].as_i64().unwrap(), 16);
}
