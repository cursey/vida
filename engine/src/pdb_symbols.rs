use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::path::{Path, PathBuf};

use goblin::pe::PE;
use pdb::{FallibleIterator, SymbolData};

const IMAGE_SCN_MEM_EXECUTE: u32 = 0x20000000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PdbFunctionSeed {
    pub(crate) start_rva: u64,
    pub(crate) name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModulePdbStatus {
    pub(crate) kind: ModulePdbStatusKind,
    pub(crate) embedded_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModulePdbStatusKind {
    NotApplicable,
    AutoFound,
    NeedsManual,
}

impl ModulePdbStatusKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::AutoFound => "auto_found",
            Self::NeedsManual => "needs_manual",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PdbValidationError {
    MissingDebugInfo,
    OpenFailed(String),
    ParseFailed(String),
    SignatureMismatch {
        expected_path: Option<String>,
        module_guid: String,
        module_age: u32,
        pdb_guid: String,
        pdb_age: u32,
    },
}

impl PdbValidationError {
    pub(crate) fn message_for_path(&self, pdb_path: &Path) -> String {
        let display_path = pdb_path.display();
        match self {
            Self::MissingDebugInfo => "This module does not advertise CodeView/RSDS PDB metadata, so the selected PDB cannot be validated.".to_owned(),
            Self::OpenFailed(error) => {
                format!("Could not open the selected PDB '{display_path}': {error}")
            }
            Self::ParseFailed(error) => {
                format!("The selected file '{display_path}' is not a readable PDB: {error}")
            }
            Self::SignatureMismatch {
                expected_path,
                module_guid,
                module_age,
                pdb_guid,
                pdb_age,
            } => {
                let mut message = format!(
                    "The selected PDB '{display_path}' does not match this module. Choose the PDB generated for the same build (matching RSDS GUID and age)."
                );
                message.push_str(" Module RSDS GUID/Age: ");
                message.push_str(module_guid);
                message.push_str(" / ");
                message.push_str(&module_age.to_string());
                message.push_str(". Selected PDB GUID/Age: ");
                message.push_str(pdb_guid);
                message.push_str(" / ");
                message.push_str(&pdb_age.to_string());
                message.push('.');
                if let Some(expected_path) =
                    expected_path.as_deref().filter(|path| !path.trim().is_empty())
                {
                    message.push_str(" Embedded PDB path from the module: '");
                    message.push_str(expected_path);
                    message.push_str("'.");
                }
                message
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RsdsInfo {
    guid: [u8; 16],
    age: u32,
    pdb_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum SymbolPriority {
    Public,
    Procedure,
}

pub(crate) fn inspect_module_pdb_status(module_path: &Path, pe: &PE<'_>) -> ModulePdbStatus {
    let Some(rsds_info) = extract_rsds_info(pe) else {
        return ModulePdbStatus {
            kind: ModulePdbStatusKind::NotApplicable,
            embedded_path: None,
        };
    };

    if has_matching_pdb_candidate(module_path, &rsds_info, pe) {
        ModulePdbStatus {
            kind: ModulePdbStatusKind::AutoFound,
            embedded_path: Some(rsds_info.pdb_path),
        }
    } else {
        ModulePdbStatus {
            kind: ModulePdbStatusKind::NeedsManual,
            embedded_path: Some(rsds_info.pdb_path),
        }
    }
}

pub(crate) fn validate_manual_pdb_path(
    pe: &PE<'_>,
    pdb_path: &Path,
) -> Result<(), PdbValidationError> {
    let rsds_info = extract_rsds_info(pe).ok_or(PdbValidationError::MissingDebugInfo)?;
    let _ = load_matching_pdb_function_seeds(pdb_path, &rsds_info, pe)?;
    Ok(())
}

pub(crate) fn discover_pdb_function_seeds(
    module_path: &Path,
    pe: &PE<'_>,
    manual_pdb_path: Option<&Path>,
) -> Result<Vec<PdbFunctionSeed>, PdbValidationError> {
    let Some(rsds_info) = extract_rsds_info(pe) else {
        return Ok(Vec::new());
    };

    if let Some(pdb_path) = manual_pdb_path {
        return load_matching_pdb_function_seeds(pdb_path, &rsds_info, pe);
    }

    let mut matched_empty = false;
    for candidate in build_pdb_candidate_paths(module_path, &rsds_info.pdb_path) {
        if !candidate.is_file() {
            continue;
        }

        match load_matching_pdb_function_seeds(&candidate, &rsds_info, pe) {
            Ok(seeds) if !seeds.is_empty() => return Ok(seeds),
            Ok(_) => matched_empty = true,
            Err(_) => {}
        }
    }

    if matched_empty {
        return Ok(Vec::new());
    }

    Ok(Vec::new())
}

fn has_matching_pdb_candidate(module_path: &Path, rsds_info: &RsdsInfo, pe: &PE<'_>) -> bool {
    build_pdb_candidate_paths(module_path, &rsds_info.pdb_path)
        .into_iter()
        .filter(|candidate| candidate.is_file())
        .any(|candidate| load_matching_pdb_function_seeds(&candidate, rsds_info, pe).is_ok())
}

fn extract_rsds_info(pe: &PE<'_>) -> Option<RsdsInfo> {
    let debug_data = pe.debug_data.as_ref()?;
    let cv70 = debug_data.codeview_pdb70_debug_info.as_ref()?;
    let pdb_path = parse_codeview_filename(cv70.filename);
    if pdb_path.is_empty() {
        return None;
    }

    Some(RsdsInfo {
        guid: cv70.signature,
        age: cv70.age,
        pdb_path,
    })
}

fn parse_codeview_filename(bytes: &[u8]) -> String {
    let nul_index = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..nul_index])
        .trim()
        .to_owned()
}

fn build_pdb_candidate_paths(module_path: &Path, embedded_path: &str) -> Vec<PathBuf> {
    let module_dir = module_path.parent().unwrap_or_else(|| Path::new("."));
    let module_stem = module_path.file_stem().and_then(|value| value.to_str());
    let embedded = PathBuf::from(embedded_path);

    let mut candidates = Vec::with_capacity(4);
    if embedded.is_absolute() {
        candidates.push(embedded.clone());
    }
    if !embedded.as_os_str().is_empty() {
        candidates.push(module_dir.join(&embedded));
        if let Some(file_name) = embedded.file_name() {
            candidates.push(module_dir.join(file_name));
        }
    }
    if let Some(stem) = module_stem {
        candidates.push(module_dir.join(format!("{stem}.pdb")));
    }

    dedupe_paths(candidates)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::with_capacity(paths.len());

    for path in paths {
        let key = path_key(&path);
        if seen.insert(key) {
            deduped.push(path);
        }
    }

    deduped
}

fn path_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        path.to_string_lossy().to_ascii_lowercase()
    }

    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

fn load_matching_pdb_function_seeds(
    pdb_path: &Path,
    rsds_info: &RsdsInfo,
    pe: &PE<'_>,
) -> Result<Vec<PdbFunctionSeed>, PdbValidationError> {
    let file =
        File::open(pdb_path).map_err(|error| PdbValidationError::OpenFailed(error.to_string()))?;
    let mut pdb =
        pdb::PDB::open(file).map_err(|error| PdbValidationError::ParseFailed(error.to_string()))?;

    let pdb_info = pdb
        .pdb_information()
        .map_err(|error| PdbValidationError::ParseFailed(error.to_string()))?;
    let pdb_guid = pdb_info.guid.to_bytes_le();
    if pdb_info.age != rsds_info.age || pdb_guid != rsds_info.guid {
        return Err(PdbValidationError::SignatureMismatch {
            expected_path: Some(rsds_info.pdb_path.clone()),
            module_guid: format_rsds_guid(rsds_info.guid),
            module_age: rsds_info.age,
            pdb_guid: format_rsds_guid(pdb_guid),
            pdb_age: pdb_info.age,
        });
    }

    let address_map = pdb
        .address_map()
        .map_err(|error| PdbValidationError::ParseFailed(error.to_string()))?;
    let symbol_table = pdb
        .global_symbols()
        .map_err(|error| PdbValidationError::ParseFailed(error.to_string()))?;

    let mut by_rva = BTreeMap::<u64, (SymbolPriority, String)>::new();
    let mut symbols = symbol_table.iter();
    while let Some(symbol) = symbols
        .next()
        .map_err(|error| PdbValidationError::ParseFailed(error.to_string()))?
    {
        let parsed = match symbol.parse() {
            Ok(value) => value,
            Err(_) => continue,
        };

        match parsed {
            SymbolData::Procedure(procedure) => {
                let Some(rva) = procedure.offset.to_rva(&address_map) else {
                    continue;
                };
                let rva = u64::from(rva.0);
                if !is_executable_rva(pe, rva) {
                    continue;
                }

                let name = normalize_symbol_name(procedure.name.to_string().into_owned());
                if name.is_empty() {
                    continue;
                }

                insert_symbol(&mut by_rva, rva, SymbolPriority::Procedure, name);
            }
            SymbolData::Public(public) => {
                if !public.function && !public.code {
                    continue;
                }

                let Some(rva) = public.offset.to_rva(&address_map) else {
                    continue;
                };
                let rva = u64::from(rva.0);
                if !is_executable_rva(pe, rva) {
                    continue;
                }

                let name = normalize_symbol_name(public.name.to_string().into_owned());
                if name.is_empty() {
                    continue;
                }

                insert_symbol(&mut by_rva, rva, SymbolPriority::Public, name);
            }
            _ => {}
        }
    }

    Ok(by_rva
        .into_iter()
        .map(|(start_rva, (_, name))| PdbFunctionSeed { start_rva, name })
        .collect())
}

fn insert_symbol(
    by_rva: &mut BTreeMap<u64, (SymbolPriority, String)>,
    rva: u64,
    priority: SymbolPriority,
    name: String,
) {
    match by_rva.get(&rva) {
        Some((existing_priority, _)) if *existing_priority >= priority => {}
        _ => {
            by_rva.insert(rva, (priority, name));
        }
    }
}

fn normalize_symbol_name(raw_name: String) -> String {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(demangled) = rustc_demangle::try_demangle(trimmed) {
        return simplify_function_name(&format!("{demangled:#}"));
    }

    if let Ok(demangled) = msvc_demangler::demangle(trimmed, msvc_demangler::DemangleFlags::llvm())
    {
        return simplify_function_name(&demangled);
    }

    simplify_function_name(trimmed)
}

fn simplify_function_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let without_hash = strip_rust_hash_suffix(trimmed);
    let signature_prefix = without_hash
        .split_once('(')
        .map(|(prefix, _)| prefix.trim_end())
        .unwrap_or(without_hash)
        .trim();
    if signature_prefix.is_empty() {
        return String::new();
    }

    let start = if let Some(operator_start) = find_operator_start(signature_prefix) {
        find_trailing_name_start(&signature_prefix[..operator_start])
    } else {
        find_trailing_name_start(signature_prefix)
    };

    signature_prefix[start..].trim().to_owned()
}

fn strip_rust_hash_suffix(name: &str) -> &str {
    let Some((prefix, suffix)) = name.rsplit_once("::h") else {
        return name;
    };

    if suffix.len() == 16 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        prefix
    } else {
        name
    }
}

fn find_operator_start(name: &str) -> Option<usize> {
    name.rmatch_indices("operator")
        .map(|(index, _)| index)
        .find(|index| {
            let before = name[..*index].chars().next_back();
            let after = name[*index + "operator".len()..].chars().next();
            !before.is_some_and(is_identifier_char) && !after.is_some_and(is_identifier_char)
        })
}

fn find_trailing_name_start(name: &str) -> usize {
    let mut angle_depth = 0_u32;

    for (index, ch) in name.char_indices().rev() {
        match ch {
            '>' => angle_depth = angle_depth.saturating_add(1),
            '<' => angle_depth = angle_depth.saturating_sub(1),
            ' ' | '\t' if angle_depth == 0 => return index + ch.len_utf8(),
            _ => {}
        }
    }

    0
}

fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn format_rsds_guid(guid: [u8; 16]) -> String {
    let data1 = u32::from_le_bytes([guid[0], guid[1], guid[2], guid[3]]);
    let data2 = u16::from_le_bytes([guid[4], guid[5]]);
    let data3 = u16::from_le_bytes([guid[6], guid[7]]);

    format!(
        "{data1:08x}-{data2:04x}-{data3:04x}-{b8:02x}{b9:02x}-{b10:02x}{b11:02x}{b12:02x}{b13:02x}{b14:02x}{b15:02x}",
        b8 = guid[8],
        b9 = guid[9],
        b10 = guid[10],
        b11 = guid[11],
        b12 = guid[12],
        b13 = guid[13],
        b14 = guid[14],
        b15 = guid[15],
    )
}

fn is_executable_rva(pe: &PE<'_>, rva: u64) -> bool {
    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if rva < start || rva >= end {
            continue;
        }
        return section.characteristics & IMAGE_SCN_MEM_EXECUTE != 0;
    }

    false
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        ModulePdbStatusKind, PdbValidationError, build_pdb_candidate_paths, format_rsds_guid,
        normalize_symbol_name, parse_codeview_filename, simplify_function_name,
    };

    #[test]
    fn parses_codeview_filename_up_to_nul() {
        let parsed = parse_codeview_filename(b"abc\\def\\x.pdb\0ignored");
        assert_eq!(parsed, "abc\\def\\x.pdb");
    }

    #[test]
    fn builds_targeted_candidates_with_deduplication() {
        let module_path = Path::new("fixtures/minimal_x64.exe");
        let candidates = build_pdb_candidate_paths(module_path, "symbols\\fixture_builder.pdb");
        let expected_with_embedded = Path::new("fixtures").join("symbols\\fixture_builder.pdb");
        let expected_basename = Path::new("fixtures").join("fixture_builder.pdb");
        let expected_module_stem = Path::new("fixtures").join("minimal_x64.pdb");

        assert_eq!(candidates.len(), 3);
        assert_eq!(candidates[0], expected_with_embedded);
        assert_eq!(candidates[1], expected_basename);
        assert_eq!(candidates[2], expected_module_stem);
    }

    #[test]
    fn exposes_stable_status_strings_and_manual_error_messages() {
        assert_eq!(
            ModulePdbStatusKind::NotApplicable.as_str(),
            "not_applicable"
        );
        assert_eq!(ModulePdbStatusKind::AutoFound.as_str(), "auto_found");
        assert_eq!(ModulePdbStatusKind::NeedsManual.as_str(), "needs_manual");

        let path = Path::new("fixture_builder.pdb");
        assert!(
            PdbValidationError::SignatureMismatch {
                expected_path: Some("symbols\\fixture_builder.pdb".to_owned()),
                module_guid: "00112233-4455-6677-8899-aabbccddeeff".to_owned(),
                module_age: 2,
                pdb_guid: "11112222-3333-4444-5555-666677778888".to_owned(),
                pdb_age: 7,
            }
                .message_for_path(path)
                .contains("generated for the same build")
        );
        assert!(
            PdbValidationError::SignatureMismatch {
                expected_path: Some("symbols\\fixture_builder.pdb".to_owned()),
                module_guid: "00112233-4455-6677-8899-aabbccddeeff".to_owned(),
                module_age: 2,
                pdb_guid: "11112222-3333-4444-5555-666677778888".to_owned(),
                pdb_age: 7,
            }
            .message_for_path(path)
            .contains("symbols\\fixture_builder.pdb")
        );
        assert!(
            PdbValidationError::SignatureMismatch {
                expected_path: Some("symbols\\fixture_builder.pdb".to_owned()),
                module_guid: "00112233-4455-6677-8899-aabbccddeeff".to_owned(),
                module_age: 2,
                pdb_guid: "11112222-3333-4444-5555-666677778888".to_owned(),
                pdb_age: 7,
            }
            .message_for_path(path)
            .contains("Module RSDS GUID/Age: 00112233-4455-6677-8899-aabbccddeeff / 2")
        );
        assert!(
            PdbValidationError::SignatureMismatch {
                expected_path: Some("symbols\\fixture_builder.pdb".to_owned()),
                module_guid: "00112233-4455-6677-8899-aabbccddeeff".to_owned(),
                module_age: 2,
                pdb_guid: "11112222-3333-4444-5555-666677778888".to_owned(),
                pdb_age: 7,
            }
            .message_for_path(path)
            .contains("Selected PDB GUID/Age: 11112222-3333-4444-5555-666677778888 / 7")
        );
        assert!(
            PdbValidationError::ParseFailed("unexpected page".to_owned())
                .message_for_path(path)
                .contains("not a readable PDB")
        );
    }

    #[test]
    fn formats_rsds_guid_in_standard_text_form() {
        let guid = [
            0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
            0xdd, 0xee, 0xff,
        ];
        assert_eq!(
            format_rsds_guid(guid),
            "00112233-4455-6677-8899-aabbccddeeff"
        );
    }

    #[test]
    fn prefers_demangled_names_when_possible() {
        let rust = normalize_symbol_name("_ZN4test4main17h1234567890abcdefE".to_owned());
        assert_eq!(rust, "test::main");

        let msvc = normalize_symbol_name("??_0klass@@QEAAHH@Z".to_owned());
        assert_ne!(msvc, "??_0klass@@QEAAHH@Z");
        assert!(msvc.contains("klass"));
        assert!(!msvc.contains('('));
    }

    #[test]
    fn strips_function_signatures_to_display_names() {
        assert_eq!(
            simplify_function_name("public: void __cdecl ns::widget::draw(int)"),
            "ns::widget::draw"
        );
        assert_eq!(
            simplify_function_name(
                "public: static void * __cdecl ns::widget::operator new(unsigned __int64)"
            ),
            "ns::widget::operator new"
        );
        assert_eq!(
            simplify_function_name("unsigned int main(int, char const * *)"),
            "main"
        );
        assert_eq!(
            simplify_function_name("crate::module::run::h0123456789abcdef"),
            "crate::module::run"
        );
        assert_eq!(
            simplify_function_name(
                "public: class std::unique_ptr<class ns::value,struct std::default_delete<class ns::value> > __cdecl ns::widget<class std::vector<struct std::pair<int,float>,class std::allocator<struct std::pair<int,float> > > >::build<class foo::bar<int, class baz::qux<long> > >(void)"
            ),
            "ns::widget<class std::vector<struct std::pair<int,float>,class std::allocator<struct std::pair<int,float> > > >::build<class foo::bar<int, class baz::qux<long> > >"
        );
        assert_eq!(
            simplify_function_name(
                "public: __cdecl ns::widget<class std::vector<int,class std::allocator<int> > >::operator class std::basic_string<char,struct std::char_traits<char>,class std::allocator<char> >(void)"
            ),
            "ns::widget<class std::vector<int,class std::allocator<int> > >::operator class std::basic_string<char,struct std::char_traits<char>,class std::allocator<char> >"
        );
    }
}
