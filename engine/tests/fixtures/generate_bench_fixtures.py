from __future__ import annotations

from pathlib import Path


OVERLAY_SIZE = 4 * 1024 * 1024
OVERLAY_PATTERN = bytes(range(256))


def write_if_changed(path: Path, content: bytes) -> None:
    if path.is_file() and path.read_bytes() == content:
        return
    path.write_bytes(content)


def build_overlay(size: int) -> bytes:
    repeats, remainder = divmod(size, len(OVERLAY_PATTERN))
    return (OVERLAY_PATTERN * repeats) + OVERLAY_PATTERN[:remainder]


def main() -> None:
    fixtures_dir = Path(__file__).resolve().parent
    source_exe = fixtures_dir / "minimal_x64.exe"
    if not source_exe.is_file():
        raise SystemExit(f"Missing source fixture: {source_exe}")

    source_bytes = source_exe.read_bytes()

    no_pdb_dir = fixtures_dir / "bench_no_pdb"
    overlay_dir = fixtures_dir / "bench_overlay"
    no_pdb_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir.mkdir(parents=True, exist_ok=True)

    no_pdb_exe = no_pdb_dir / "minimal_x64.exe"
    overlay_exe = overlay_dir / "minimal_x64_overlay_4mb.exe"

    write_if_changed(no_pdb_exe, source_bytes)
    write_if_changed(overlay_exe, source_bytes + build_overlay(OVERLAY_SIZE))

    stale_no_pdb = no_pdb_dir / "fixture_builder.pdb"
    stale_overlay = overlay_dir / "fixture_builder.pdb"
    if stale_no_pdb.exists():
        stale_no_pdb.unlink()
    if stale_overlay.exists():
        stale_overlay.unlink()

    print(f"Prepared benchmark fixtures:\n- {no_pdb_exe}\n- {overlay_exe}")


if __name__ == "__main__":
    main()
