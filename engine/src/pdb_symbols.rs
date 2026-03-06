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

pub(crate) fn discover_pdb_function_seeds(module_path: &Path, pe: &PE<'_>) -> Vec<PdbFunctionSeed> {
    let Some(rsds_info) = extract_rsds_info(pe) else {
        return Vec::new();
    };

    let candidates = build_pdb_candidate_paths(module_path, &rsds_info.pdb_path);
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }

        if let Ok(seeds) = load_matching_pdb_function_seeds(&candidate, &rsds_info, pe) {
            if !seeds.is_empty() {
                return seeds;
            }
        }
    }

    Vec::new()
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
) -> Result<Vec<PdbFunctionSeed>, ()> {
    let file = File::open(pdb_path).map_err(|_| ())?;
    let mut pdb = pdb::PDB::open(file).map_err(|_| ())?;

    let pdb_info = pdb.pdb_information().map_err(|_| ())?;
    let pdb_guid = pdb_info.guid.to_bytes_le();
    if pdb_info.age != rsds_info.age || pdb_guid != rsds_info.guid {
        return Err(());
    }

    let address_map = pdb.address_map().map_err(|_| ())?;
    let symbol_table = pdb.global_symbols().map_err(|_| ())?;

    let mut by_rva = BTreeMap::<u64, (SymbolPriority, String)>::new();
    let mut symbols = symbol_table.iter();
    while let Some(symbol) = symbols.next().map_err(|_| ())? {
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

    let tokens = signature_prefix.split_whitespace().collect::<Vec<_>>();
    if tokens.is_empty() {
        return signature_prefix.to_owned();
    }

    if let Some(index) = tokens
        .iter()
        .rposition(|token| *token == "operator" || token.ends_with("::operator"))
    {
        return tokens[index..].join(" ");
    }

    if let Some(index) = tokens.iter().rposition(|token| token.contains("::")) {
        return tokens[index..].join(" ");
    }

    tokens[tokens.len() - 1].to_owned()
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
        build_pdb_candidate_paths, normalize_symbol_name, parse_codeview_filename,
        simplify_function_name,
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
            simplify_function_name("public: static void * __cdecl ns::widget::operator new(unsigned __int64)"),
            "ns::widget::operator new"
        );
        assert_eq!(simplify_function_name("unsigned int main(int, char const * *)"), "main");
        assert_eq!(
            simplify_function_name("crate::module::run::h0123456789abcdef"),
            "crate::module::run"
        );
    }
}
