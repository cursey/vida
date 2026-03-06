use goblin::pe::PE;
use iced_x86::{
    Decoder, DecoderOptions, FlowControl, Formatter, Instruction, IntelFormatter, Mnemonic,
};

use crate::disasm::{bytes_to_hex, categorize_instruction, split_instruction_text, to_hex};
use crate::error::EngineError;
use crate::pe_utils::get_byte_at_rva;
use crate::protocol::LinearViewRow;

pub(crate) const DATA_GROUP_SIZE: u64 = 16;
pub(crate) const LINEAR_ROW_HEIGHT: u64 = 24;
pub(crate) const MAX_LINEAR_PAGE_ROWS: usize = 4096;

const IMAGE_SCN_MEM_EXECUTE: u32 = 0x20000000;

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
    Exec(ExecSegment),
    Data,
    Gap,
}

#[derive(Debug)]
struct ExecSegment {
    rows: Vec<ExecRowIndex>,
}

#[derive(Debug)]
struct ExecRowIndex {
    rva: u64,
    len: u8,
    decoded: bool,
}

#[derive(Debug)]
struct RangeSpec {
    start: u64,
    end: u64,
    exec: bool,
}

pub(crate) fn build_linear_view(bytes: &[u8], pe: &PE<'_>) -> Result<LinearView, EngineError> {
    let mut ranges = collect_mapped_ranges(pe);
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
            let gap_len = range.start - previous_end;
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count: 1,
                start_rva: previous_end,
                end_rva: range.start,
                kind: LinearSegmentKind::Gap,
            });
            row_cursor += 1;
            if gap_len == 0 {
                continue;
            }
        }

        if range.end <= range.start {
            previous_end = range.end;
            continue;
        }

        if range.exec {
            let exec_rows = build_exec_rows(bytes, pe, range.start, range.end)?;
            if exec_rows.is_empty() {
                previous_end = range.end;
                continue;
            }
            let row_count = exec_rows.len() as u64;
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count,
                start_rva: range.start,
                end_rva: range.end,
                kind: LinearSegmentKind::Exec(ExecSegment { rows: exec_rows }),
            });
            row_cursor += row_count;
        } else {
            let row_count = (range.end - range.start).div_ceil(DATA_GROUP_SIZE);
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count,
                start_rva: range.start,
                end_rva: range.end,
                kind: LinearSegmentKind::Data,
            });
            row_cursor += row_count;
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

fn collect_mapped_ranges(pe: &PE<'_>) -> Vec<RangeSpec> {
    let mut ranges = Vec::new();

    let size_of_headers = pe
        .header
        .optional_header
        .as_ref()
        .map(|value| value.windows_fields.size_of_headers as u64)
        .unwrap_or(0);
    if size_of_headers > 0 {
        ranges.push(RangeSpec {
            start: 0,
            end: size_of_headers,
            exec: false,
        });
    }

    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if end <= start {
            continue;
        }
        let exec = section.characteristics & IMAGE_SCN_MEM_EXECUTE != 0;
        ranges.push(RangeSpec { start, end, exec });
    }

    ranges
}

fn normalize_ranges(sorted_ranges: Vec<RangeSpec>) -> Vec<RangeSpec> {
    let mut output = Vec::<RangeSpec>::new();
    for range in sorted_ranges {
        if output.is_empty() {
            output.push(range);
            continue;
        }

        let mut trailing: Option<RangeSpec> = None;
        let mut append = false;
        {
            let last = output.last_mut().expect("non-empty");
            if range.start >= last.end {
                append = true;
            } else if range.exec == last.exec {
                if range.end > last.end {
                    last.end = range.end;
                }
            } else if range.end > last.end {
                trailing = Some(RangeSpec {
                    start: last.end,
                    end: range.end,
                    exec: range.exec,
                });
            }
        }

        if append {
            output.push(range);
            continue;
        }
        if let Some(spec) = trailing {
            output.push(spec);
        }
    }
    output
}

fn build_exec_rows(
    bytes: &[u8],
    pe: &PE<'_>,
    start_rva: u64,
    end_rva: u64,
) -> Result<Vec<ExecRowIndex>, EngineError> {
    let mut rows = Vec::<ExecRowIndex>::new();
    let mut rva = start_rva;
    let image_base = pe.image_base as u64;
    let mut invalid_streak = 0usize;

    while rva < end_rva {
        let window_len = usize::try_from((end_rva - rva).min(15))
            .map_err(|error| EngineError::Internal(error.to_string()))?;
        let mut decode_window = Vec::with_capacity(window_len);
        for offset in 0..window_len {
            decode_window.push(get_byte_at_rva(bytes, pe, rva + offset as u64));
        }

        let mut decoder =
            Decoder::with_ip(64, &decode_window, image_base + rva, DecoderOptions::NONE);
        let mut instruction = Instruction::default();
        decoder.decode_out(&mut instruction);

        if instruction.mnemonic() == Mnemonic::INVALID
            || instruction.len() == 0
            || instruction.len() as usize > window_len
        {
            invalid_streak += 1;
            let _ = invalid_streak;
            rows.push(ExecRowIndex {
                rva,
                len: 1,
                decoded: false,
            });
            rva += 1;
            continue;
        }

        invalid_streak = 0;
        let len = instruction.len().min(u8::MAX as usize) as u8;
        rows.push(ExecRowIndex {
            rva,
            len,
            decoded: true,
        });
        rva += u64::from(len);
    }

    Ok(rows)
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
        LinearSegmentKind::Exec(exec) => {
            let index = exec.rows.partition_point(|row| row.rva <= rva);
            if index == 0 {
                return Ok(segment.start_row);
            }
            Ok(segment.start_row + (index as u64 - 1))
        }
    }
}

pub(crate) fn materialize_linear_row(
    view: &LinearView,
    bytes: &[u8],
    pe: &PE<'_>,
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
            let count = remaining.min(DATA_GROUP_SIZE);
            let mut byte_values = Vec::new();
            for index in 0..count {
                byte_values.push(get_byte_at_rva(bytes, pe, rva + index));
            }
            let bytes_text = bytes_to_hex(&byte_values);
            let operands = byte_values
                .iter()
                .map(|value| format!("0x{value:02X}"))
                .collect::<Vec<String>>()
                .join(", ");

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
        LinearSegmentKind::Exec(exec) => {
            let exec_row = exec
                .rows
                .get(row_offset as usize)
                .ok_or_else(|| EngineError::Internal("Invalid exec row offset".to_owned()))?;
            if !exec_row.decoded {
                let value = get_byte_at_rva(bytes, pe, exec_row.rva);
                return Ok(LinearViewRow {
                    kind: "data",
                    address: to_hex(image_base + exec_row.rva),
                    bytes: format!("{value:02X}"),
                    mnemonic: "db".to_owned(),
                    operands: format!("0x{value:02X}"),
                    instruction_category: None,
                    branch_target: None,
                    call_target: None,
                    comment: Some("invalid decode fallback".to_owned()),
                });
            }

            let window_len = usize::try_from((segment.end_rva - exec_row.rva).min(15))
                .map_err(|error| EngineError::Internal(error.to_string()))?;
            let mut decode_window = Vec::with_capacity(window_len);
            for offset in 0..window_len {
                decode_window.push(get_byte_at_rva(bytes, pe, exec_row.rva + offset as u64));
            }

            let image_base = pe.image_base as u64;
            let mut decoder = Decoder::with_ip(
                64,
                &decode_window,
                image_base + exec_row.rva,
                DecoderOptions::NONE,
            );
            let mut instruction = Instruction::default();
            decoder.decode_out(&mut instruction);

            if instruction.mnemonic() == Mnemonic::INVALID || instruction.len() == 0 {
                let value = get_byte_at_rva(bytes, pe, exec_row.rva);
                return Ok(LinearViewRow {
                    kind: "data",
                    address: to_hex(image_base + exec_row.rva),
                    bytes: format!("{value:02X}"),
                    mnemonic: "db".to_owned(),
                    operands: format!("0x{value:02X}"),
                    instruction_category: None,
                    branch_target: None,
                    call_target: None,
                    comment: Some("invalid decode fallback".to_owned()),
                });
            }

            let mut formatter = IntelFormatter::new();
            let mut instruction_text = String::new();
            formatter.format(&instruction, &mut instruction_text);
            let (mnemonic, operands) = split_instruction_text(&instruction_text);
            let instruction_category = categorize_instruction(&instruction, &mnemonic);
            let len = usize::from(exec_row.len);
            let bytes_text = bytes_to_hex(&decode_window[0..len.min(decode_window.len())]);

            let branch_target = match instruction.flow_control() {
                FlowControl::ConditionalBranch | FlowControl::UnconditionalBranch => {
                    Some(to_hex(instruction.near_branch_target()))
                }
                _ => None,
            };
            let call_target = match instruction.flow_control() {
                FlowControl::Call => Some(to_hex(instruction.near_branch_target())),
                _ => None,
            };

            Ok(LinearViewRow {
                kind: "instruction",
                address: to_hex(image_base + exec_row.rva),
                bytes: bytes_text,
                mnemonic,
                operands,
                instruction_category: Some(instruction_category),
                branch_target,
                call_target,
                comment: None,
            })
        }
    }
}
