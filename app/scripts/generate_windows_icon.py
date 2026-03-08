from pathlib import Path
from io import BytesIO
import struct
from typing import cast

from PIL import Image


WINDOWS_ICON_SIZES = [256, 128, 64, 48, 40, 32, 24, 20, 16]


def encode_png_frame(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def encode_bmp_frame(image: Image.Image) -> bytes:
    width, height = image.size

    xor_bitmap = bytearray()
    for y in range(height - 1, -1, -1):
        for x in range(width):
            red, green, blue, alpha = cast(
                tuple[int, int, int, int], image.getpixel((x, y))
            )
            xor_bitmap.extend((blue, green, red, alpha))

    mask_stride = ((width + 31) // 32) * 4
    and_mask = bytes(mask_stride * height)

    header = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        len(xor_bitmap) + len(and_mask),
        0,
        0,
        0,
        0,
    )

    return header + xor_bitmap + and_mask


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    icons_dir = repo_root / "app" / "src-tauri" / "icons"
    source_path = icons_dir / "icon-source.png"
    output_path = icons_dir / "icon.ico"

    source = Image.open(source_path).convert("RGBA")
    frame_payloads: list[tuple[int, bytes]] = []
    for size in WINDOWS_ICON_SIZES:
        frame = source.resize((size, size), Image.Resampling.NEAREST)
        payload = encode_png_frame(frame) if size == 256 else encode_bmp_frame(frame)
        frame_payloads.append((size, payload))

    header = struct.pack("<HHH", 0, 1, len(frame_payloads))
    directory = bytearray()
    image_offset = 6 + (16 * len(frame_payloads))
    payload_bytes = bytearray()

    for size, payload in frame_payloads:
        encoded_size = 0 if size >= 256 else size
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                encoded_size,
                encoded_size,
                0,
                0,
                1,
                32,
                len(payload),
                image_offset,
            )
        )
        payload_bytes.extend(payload)
        image_offset += len(payload)

    output_path.write_bytes(header + directory + payload_bytes)

    print(f"Wrote {output_path} with sizes: {WINDOWS_ICON_SIZES}")


if __name__ == "__main__":
    main()
