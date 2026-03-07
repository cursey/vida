use std::collections::BTreeMap;
use std::fmt::Write as FmtWrite;

use crate::api::{InstructionCategory, LinearViewRow};
use crate::disasm::{bytes_to_hex, to_hex};
use crate::error::EngineError;
use crate::pe_utils::SectionLookup;

pub(crate) const DATA_GROUP_SIZE: u64 = 16;
pub(crate) const LINEAR_ROW_HEIGHT: u64 = 24;
pub(crate) const MAX_LINEAR_PAGE_ROWS: usize = 4096;

#[derive(Debug, Clone)]
pub(crate) struct AnalyzedInstructionRow {
    pub(crate) start_rva: u64,
    pub(crate) len: u8,
    pub(crate) bytes: String,
    pub(crate) mnemonic: String,
    pub(crate) operands: String,
    pub(crate) instruction_category: InstructionCategory,
    pub(crate) branch_target_rva: Option<u64>,
    pub(crate) call_target_rva: Option<u64>,
}

impl AnalyzedInstructionRow {
    fn end_rva(&self) -> u64 {
        self.start_rva.saturating_add(u64::from(self.len))
    }
}

#[derive(Debug)]
pub(crate) struct LinearView {
    pub(crate) row_count: u64,
    pub(crate) min_rva: u64,
    pub(crate) max_rva: u64,
    segments: Vec<LinearSegment>,
}

#[derive(Debug)]
struct LinearSegment {
    start_row: u64,
    row_count: u64,
    start_rva: u64,
    end_rva: u64,
    kind: LinearSegmentKind,
}

#[derive(Debug)]
enum LinearSegmentKind {
    Instructions(InstructionSegment),
    Data,
    Gap,
}

#[derive(Debug)]
struct InstructionSegment {
    rows: Vec<AnalyzedInstructionRow>,
}

#[derive(Debug, Clone, Copy)]
struct RangeSpec {
    start: u64,
    end: u64,
}

pub(crate) fn build_linear_view(
    section_lookup: &SectionLookup,
    instruction_rows: &BTreeMap<u64, AnalyzedInstructionRow>,
) -> Result<LinearView, EngineError> {
    let mut ranges = collect_mapped_ranges(section_lookup);
    if ranges.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    ranges.sort_by_key(|value| value.start);
    let normalized = normalize_ranges(ranges);
    if normalized.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    let mut segments = Vec::new();
    let mut row_cursor = 0u64;
    let mut previous_end = normalized[0].start;

    for range in normalized {
        if previous_end < range.start {
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count: 1,
                start_rva: previous_end,
                end_rva: range.start,
                kind: LinearSegmentKind::Gap,
            });
            row_cursor += 1;
        }

        if range.end <= range.start {
            previous_end = range.end;
            continue;
        }

        let mut cursor = range.start;
        while cursor < range.end {
            let Some((_, next_instruction)) = instruction_rows
                .range(cursor..range.end)
                .next()
                .map(|(rva, row)| (*rva, row))
            else {
                let row_count = (range.end - cursor).div_ceil(DATA_GROUP_SIZE);
                if row_count > 0 {
                    segments.push(LinearSegment {
                        start_row: row_cursor,
                        row_count,
                        start_rva: cursor,
                        end_rva: range.end,
                        kind: LinearSegmentKind::Data,
                    });
                    row_cursor += row_count;
                }
                break;
            };

            if next_instruction.start_rva > cursor {
                let data_end = next_instruction.start_rva.min(range.end);
                let row_count = (data_end - cursor).div_ceil(DATA_GROUP_SIZE);
                if row_count > 0 {
                    segments.push(LinearSegment {
                        start_row: row_cursor,
                        row_count,
                        start_rva: cursor,
                        end_rva: data_end,
                        kind: LinearSegmentKind::Data,
                    });
                    row_cursor += row_count;
                }
                cursor = data_end;
                continue;
            }

            let mut rows = Vec::new();
            let mut next_cursor = cursor;
            for row in instruction_rows
                .range(cursor..range.end)
                .map(|(_, row)| row)
            {
                if row.start_rva != next_cursor {
                    break;
                }
                rows.push(row.clone());
                next_cursor = row.end_rva();
            }

            if rows.is_empty() {
                let data_end = cursor.saturating_add(DATA_GROUP_SIZE).min(range.end);
                let row_count = (data_end - cursor).div_ceil(DATA_GROUP_SIZE);
                segments.push(LinearSegment {
                    start_row: row_cursor,
                    row_count,
                    start_rva: cursor,
                    end_rva: data_end,
                    kind: LinearSegmentKind::Data,
                });
                row_cursor += row_count;
                cursor = data_end;
                continue;
            }

            let segment_start = rows.first().map(|row| row.start_rva).unwrap_or(cursor);
            let segment_end = rows
                .last()
                .map(AnalyzedInstructionRow::end_rva)
                .unwrap_or(segment_start);
            let row_count = rows.len() as u64;
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count,
                start_rva: segment_start,
                end_rva: segment_end,
                kind: LinearSegmentKind::Instructions(InstructionSegment { rows }),
            });
            row_cursor += row_count;
            cursor = segment_end;
        }

        previous_end = range.end;
    }

    if segments.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    let min_rva = segments
        .first()
        .map(|value| value.start_rva)
        .unwrap_or_default();
    let max_rva = segments
        .last()
        .map(|value| value.end_rva.saturating_sub(1))
        .unwrap_or_default();

    Ok(LinearView {
        row_count: row_cursor,
        min_rva,
        max_rva,
        segments,
    })
}

fn collect_mapped_ranges(section_lookup: &SectionLookup) -> Vec<RangeSpec> {
    let mut ranges = Vec::new();

    let size_of_headers = section_lookup.size_of_headers();
    if size_of_headers > 0 {
        ranges.push(RangeSpec {
            start: 0,
            end: size_of_headers,
        });
    }

    for section in section_lookup.sections() {
        if section.end_rva <= section.start_rva {
            continue;
        }
        ranges.push(RangeSpec {
            start: section.start_rva,
            end: section.end_rva,
        });
    }

    ranges
}

fn normalize_ranges(sorted_ranges: Vec<RangeSpec>) -> Vec<RangeSpec> {
    let mut output = Vec::<RangeSpec>::new();
    for range in sorted_ranges {
        match output.last_mut() {
            Some(last) if range.start <= last.end => {
                if range.end > last.end {
                    last.end = range.end;
                }
            }
            _ => output.push(range),
        }
    }
    output
}

fn find_segment_by_row(view: &LinearView, row: u64) -> Result<&LinearSegment, EngineError> {
    let idx = view
        .segments
        .partition_point(|segment| segment.start_row + segment.row_count <= row);
    view.segments.get(idx).ok_or(EngineError::InvalidAddress)
}

pub(crate) fn find_row_by_rva(view: &LinearView, rva: u64) -> Result<u64, EngineError> {
    let segment_index = view
        .segments
        .partition_point(|segment| segment.end_rva <= rva);
    let segment = view
        .segments
        .get(segment_index)
        .ok_or(EngineError::InvalidAddress)?;

    if rva < segment.start_rva || rva >= segment.end_rva {
        return Err(EngineError::InvalidAddress);
    }

    match &segment.kind {
        LinearSegmentKind::Gap => Ok(segment.start_row),
        LinearSegmentKind::Data => {
            let row_offset = (rva - segment.start_rva) / DATA_GROUP_SIZE;
            Ok(segment.start_row + row_offset)
        }
        LinearSegmentKind::Instructions(instructions) => {
            let index = instructions
                .rows
                .partition_point(|row| row.start_rva <= rva);
            if index == 0 {
                return Ok(segment.start_row);
            }
            let row = &instructions.rows[index - 1];
            if rva >= row.start_rva && rva < row.end_rva() {
                return Ok(segment.start_row + index as u64 - 1);
            }
            Err(EngineError::InvalidAddress)
        }
    }
}

pub(crate) fn materialize_linear_row(
    view: &LinearView,
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    row_index: u64,
) -> Result<LinearViewRow, EngineError> {
    let segment = find_segment_by_row(view, row_index)?;
    let row_offset = row_index.saturating_sub(segment.start_row);

    match &segment.kind {
        LinearSegmentKind::Gap => {
            let gap_size = segment.end_rva.saturating_sub(segment.start_rva);
            Ok(LinearViewRow {
                kind: "gap",
                address: to_hex(image_base + segment.start_rva),
                bytes: String::new(),
                mnemonic: "<gap>".to_owned(),
                operands: String::new(),
                instruction_category: None,
                branch_target: None,
                call_target: None,
                comment: Some(format!(
                    "unmapped to {} ({} bytes)",
                    to_hex(image_base + segment.end_rva),
                    gap_size
                )),
            })
        }
        LinearSegmentKind::Data => {
            let rva = segment.start_rva + row_offset * DATA_GROUP_SIZE;
            let remaining = segment.end_rva.saturating_sub(rva);
            let count = remaining.min(DATA_GROUP_SIZE) as usize;
            let mut row_bytes = [0u8; DATA_GROUP_SIZE as usize];
            for index in 0..count {
                row_bytes[index] = section_lookup.get_byte_at(bytes, rva + index as u64);
            }
            let byte_values = &row_bytes[..count];
            let bytes_text = bytes_to_hex(byte_values);

            let mut operands = String::with_capacity(count.saturating_mul(6).saturating_sub(1));
            for (index, value) in byte_values.iter().enumerate() {
                if index > 0 {
                    operands.push_str(", ");
                }
                let _ = write!(&mut operands, "0x{value:02X}");
            }

            Ok(LinearViewRow {
                kind: "data",
                address: to_hex(image_base + rva),
                bytes: bytes_text,
                mnemonic: "db".to_owned(),
                operands,
                instruction_category: None,
                branch_target: None,
                call_target: None,
                comment: None,
            })
        }
        LinearSegmentKind::Instructions(instructions) => {
            let row = instructions.rows.get(row_offset as usize).ok_or_else(|| {
                EngineError::Internal("Invalid instruction row offset".to_owned())
            })?;

            Ok(LinearViewRow {
                kind: "instruction",
                address: to_hex(image_base + row.start_rva),
                bytes: row.bytes.clone(),
                mnemonic: row.mnemonic.clone(),
                operands: row.operands.clone(),
                instruction_category: Some(row.instruction_category),
                branch_target: row
                    .branch_target_rva
                    .map(|target| to_hex(image_base + target)),
                call_target: row
                    .call_target_rva
                    .map(|target| to_hex(image_base + target)),
                comment: None,
            })
        }
    }
}
