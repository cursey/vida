use goblin::pe::PE;
use goblin::pe::exception::RuntimeFunction;

use crate::error::EngineError;

const IMAGE_SCN_MEM_EXECUTE: u32 = 0x20000000;
const IMAGE_SCN_MEM_READ: u32 = 0x40000000;
const IMAGE_SCN_MEM_WRITE: u32 = 0x80000000;

#[derive(Debug, Clone)]
pub(crate) struct SectionSlice {
    pub(crate) start_rva: u64,
    pub(crate) end_rva: u64,
    pub(crate) readable: bool,
    pub(crate) writable: bool,
    pub(crate) executable: bool,
    pub(crate) pointer_to_raw_data: usize,
    pub(crate) size_of_raw_data: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct SectionLookup {
    sections: Vec<SectionSlice>,
    size_of_headers: u64,
}

impl SectionLookup {
    pub(crate) fn sections(&self) -> &[SectionSlice] {
        &self.sections
    }

    pub(crate) fn size_of_headers(&self) -> u64 {
        self.size_of_headers
    }

    pub(crate) fn is_executable_rva(&self, rva: u64) -> bool {
        self.section_for_rva(rva)
            .is_some_and(|section| section.executable)
    }

    pub(crate) fn has_mapped_rva(&self, rva: u64) -> bool {
        rva < self.size_of_headers || self.section_for_rva(rva).is_some()
    }

    pub(crate) fn section_for_rva(&self, rva: u64) -> Option<&SectionSlice> {
        let idx = self
            .sections
            .partition_point(|section| section.start_rva <= rva);
        let section = idx
            .checked_sub(1)
            .and_then(|index| self.sections.get(index))?;
        if rva < section.end_rva {
            Some(section)
        } else {
            None
        }
    }

    pub(crate) fn get_byte_at(&self, bytes: &[u8], rva: u64) -> u8 {
        if rva < self.size_of_headers {
            return bytes.get(rva as usize).copied().unwrap_or(0);
        }

        let Some(section) = self.section_for_rva(rva) else {
            return 0;
        };

        let section_offset = rva - section.start_rva;
        if section_offset < section.size_of_raw_data {
            let file_offset = section
                .pointer_to_raw_data
                .saturating_add(section_offset as usize);
            bytes.get(file_offset).copied().unwrap_or(0)
        } else {
            0
        }
    }
}

pub(crate) fn build_section_lookup(pe: &PE<'_>) -> SectionLookup {
    let sections = pe
        .sections
        .iter()
        .map(|section| {
            let start_rva = section.virtual_address as u64;
            let section_len = u64::from(section.virtual_size.max(section.size_of_raw_data));
            let end_rva = start_rva.saturating_add(section_len);
            let size_of_raw_data = section.size_of_raw_data as u64;
            let pointer_to_raw_data = section.pointer_to_raw_data as usize;

            SectionSlice {
                start_rva,
                end_rva,
                readable: section.characteristics & IMAGE_SCN_MEM_READ != 0,
                writable: section.characteristics & IMAGE_SCN_MEM_WRITE != 0,
                executable: section.characteristics & IMAGE_SCN_MEM_EXECUTE != 0,
                pointer_to_raw_data,
                size_of_raw_data,
            }
        })
        .filter(|section| section.end_rva > section.start_rva)
        .collect::<Vec<SectionSlice>>();

    let mut sorted_sections = sections;
    sorted_sections.sort_by_key(|section| section.start_rva);

    let size_of_headers = pe
        .header
        .optional_header
        .as_ref()
        .map(|value| value.windows_fields.size_of_headers as u64)
        .unwrap_or(0);

    SectionLookup {
        sections: sorted_sections,
        size_of_headers,
    }
}

pub(crate) fn parse_pe64(bytes: &[u8]) -> Result<PE<'_>, EngineError> {
    let pe = PE::parse(bytes).map_err(|_| EngineError::UnsupportedFormat)?;
    if !pe.is_64 {
        return Err(EngineError::UnsupportedArch);
    }
    Ok(pe)
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
