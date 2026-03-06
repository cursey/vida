use goblin::pe::PE;
use goblin::pe::exception::RuntimeFunction;

use crate::error::EngineError;

const IMAGE_SCN_MEM_EXECUTE: u32 = 0x20000000;

#[derive(Debug, Clone)]
pub(crate) struct SectionSlice {
    pub(crate) end_rva: u64,
}

pub(crate) fn parse_pe64(bytes: &[u8]) -> Result<PE<'_>, EngineError> {
    let pe = PE::parse(bytes).map_err(|_| EngineError::UnsupportedFormat)?;
    if !pe.is_64 {
        return Err(EngineError::UnsupportedArch);
    }
    Ok(pe)
}

pub(crate) fn find_section_for_rva(pe: &PE<'_>, rva: u64) -> Option<SectionSlice> {
    for section in &pe.sections {
        let start_rva = section.virtual_address as u64;
        let section_len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end_rva = start_rva.saturating_add(section_len);

        if rva >= start_rva && rva < end_rva {
            return Some(SectionSlice { end_rva });
        }
    }

    None
}

pub(crate) fn collect_exception_function_starts(pe: &PE<'_>) -> Vec<u64> {
    let Some(exception_data) = pe.exception_data.as_ref() else {
        return Vec::new();
    };

    let entries = exception_data
        .functions()
        .filter_map(Result::ok)
        .collect::<Vec<RuntimeFunction>>();

    collect_exception_function_starts_from_entries(&entries, |rva| is_executable_rva(pe, rva))
}

pub(crate) fn collect_tls_callback_starts(pe: &PE<'_>) -> Vec<u64> {
    let Some(tls_data) = pe.tls_data.as_ref() else {
        return Vec::new();
    };

    collect_tls_callback_starts_from_vas(&tls_data.callbacks, pe.image_base as u64, |rva| {
        is_executable_rva(pe, rva)
    })
}

pub(crate) fn collect_tls_callback_starts_from_vas<F>(
    callback_vas: &[u64],
    image_base: u64,
    mut is_executable_start: F,
) -> Vec<u64>
where
    F: FnMut(u64) -> bool,
{
    let mut callbacks = callback_vas
        .iter()
        .copied()
        .filter_map(|callback_va| callback_va.checked_sub(image_base))
        .filter(|callback_rva| is_executable_start(*callback_rva))
        .collect::<Vec<u64>>();
    callbacks.sort_unstable();
    callbacks.dedup();
    callbacks
}

pub(crate) fn collect_exception_function_starts_from_entries<F>(
    entries: &[RuntimeFunction],
    mut is_executable_start: F,
) -> Vec<u64>
where
    F: FnMut(u64) -> bool,
{
    let mut starts = Vec::new();

    for entry in entries {
        let start = u64::from(entry.begin_address);
        let end = u64::from(entry.end_address);
        if !is_valid_exception_function_range(start, end) {
            continue;
        }
        if !is_executable_start(start) {
            continue;
        }

        starts.push(start);
    }

    starts
}

pub(crate) fn is_valid_exception_function_range(start: u64, end: u64) -> bool {
    start != 0 && end > start
}

pub(crate) fn is_executable_rva(pe: &PE<'_>, rva: u64) -> bool {
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

pub(crate) fn get_byte_at_rva(bytes: &[u8], pe: &PE<'_>, rva: u64) -> u8 {
    let size_of_headers = pe
        .header
        .optional_header
        .as_ref()
        .map(|value| value.windows_fields.size_of_headers as u64)
        .unwrap_or(0);
    if rva < size_of_headers {
        let offset = rva as usize;
        return bytes.get(offset).copied().unwrap_or(0);
    }

    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if rva < start || rva >= end {
            continue;
        }

        let section_offset = rva.saturating_sub(start);
        if section_offset < section.size_of_raw_data as u64 {
            let file_offset = section.pointer_to_raw_data as u64 + section_offset;
            return bytes.get(file_offset as usize).copied().unwrap_or(0);
        }
        return 0;
    }

    0
}
