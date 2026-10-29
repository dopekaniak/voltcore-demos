"""Safe mesh loading: format allowlist, magic bytes, zip-bomb and triangle limits."""
from __future__ import annotations

import io
import struct
import zipfile
from dataclasses import dataclass

import numpy as np
import trimesh

MAX_PRINT_BYTES = 150 * 1024 * 1024
MAX_UNCOMPRESSED = 500 * 1024 * 1024
MAX_ZIP_ENTRIES = 5000
MAX_TRIANGLES = 25_000_000
FORMATS = ("stl", "obj", "3mf", "glb")


class MeshRejected(Exception):
    """A file that fails validation. `code` is stable for clients."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Limits:
    max_bytes: int = MAX_PRINT_BYTES
    max_uncompressed: int = MAX_UNCOMPRESSED
    max_entries: int = MAX_ZIP_ENTRIES
    max_triangles: int = MAX_TRIANGLES


def sniff(data: bytes, fmt: str) -> None:
    """Check the bytes look like the declared format before parsing."""
    if fmt not in FORMATS:
        raise MeshRejected("UNSUPPORTED_FORMAT", f"{fmt} is not a supported format")
    if fmt == "3mf":
        if not data.startswith(b"PK\x03\x04"):
            raise MeshRejected("BAD_SIGNATURE", "3MF files are ZIP archives; this one is not")
    elif fmt == "glb":
        if not data.startswith(b"glTF"):
            raise MeshRejected("BAD_SIGNATURE", "not a binary glTF file")
    elif fmt == "stl":
        if len(data) < 15:
            raise MeshRejected("BAD_SIGNATURE", "file is too small to be an STL")
        head = data[:512].lstrip().lower()
        is_ascii = head.startswith(b"solid") and b"facet" in data[:4096].lower()
        if not is_ascii:
            if len(data) < 84:
                raise MeshRejected("BAD_SIGNATURE", "binary STL header is truncated")
            (n,) = struct.unpack("<I", data[80:84])
            if 84 + n * 50 != len(data):
                raise MeshRejected("BAD_SIGNATURE", "binary STL triangle count does not match the file size")
    elif fmt == "obj":
        sample = data[:65536]
        if b"\x00" in sample:
            raise MeshRejected("BAD_SIGNATURE", "OBJ files are text; this one contains binary data")
        if not any(line.lstrip().startswith((b"v ", b"f ")) for line in sample.splitlines()):
            raise MeshRejected("BAD_SIGNATURE", "no vertices or faces found in the OBJ")


def check_zip(data: bytes, limits: Limits) -> None:
    """Reject zip bombs from the central directory, before inflating anything."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise MeshRejected("BAD_ARCHIVE", f"the 3MF archive is damaged: {e}") from e
    infos = zf.infolist()
    if len(infos) > limits.max_entries:
        raise MeshRejected("ZIP_TOO_MANY_ENTRIES", f"the 3MF has {len(infos)} entries; the limit is {limits.max_entries}")
    total = sum(i.file_size for i in infos)
    if total > limits.max_uncompressed:
        raise MeshRejected("ZIP_TOO_LARGE", f"the 3MF expands to {total // (1024 * 1024)} MB; the limit is {limits.max_uncompressed // (1024 * 1024)} MB")
    for i in infos:
        if i.compress_size and i.file_size > 1024 * 1024 and i.file_size / max(i.compress_size, 1) > 500:
            raise MeshRejected("ZIP_RATIO", "the 3MF has an implausible compression ratio")


def load_mesh(data: bytes, fmt: str, limits: Limits | None = None) -> trimesh.Trimesh:
    limits = limits or Limits()
    if len(data) > limits.max_bytes:
        raise MeshRejected("TOO_LARGE", f"file is larger than {limits.max_bytes // (1024 * 1024)} MB")
    sniff(data, fmt)
    if fmt == "3mf":
        check_zip(data, limits)
    if fmt == "stl" and not data[:512].lstrip().lower().startswith(b"solid"):
        (n,) = struct.unpack("<I", data[80:84])
        if n > limits.max_triangles:
            raise MeshRejected("TOO_MANY_TRIANGLES", f"{n} triangles; the limit is {limits.max_triangles}")
    try:
        loaded = trimesh.load(io.BytesIO(data), file_type=fmt, force="mesh", process=False)
    except Exception as e:  # trimesh raises many types for broken files
        raise MeshRejected("PARSE_FAILED", f"could not read the {fmt.upper()} file: {e}") from e
    if not isinstance(loaded, trimesh.Trimesh) or len(loaded.faces) == 0:
        raise MeshRejected("EMPTY", "the file contains no triangles")
    if len(loaded.faces) > limits.max_triangles:
        raise MeshRejected("TOO_MANY_TRIANGLES", f"{len(loaded.faces)} triangles; the limit is {limits.max_triangles}")
    if fmt == "glb":
        # glTF is Y-up; the print pipeline is Z-up.
        loaded.apply_transform(Y_UP_TO_Z_UP)
    return loaded


Y_UP_TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
Z_UP_TO_Y_UP = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])


def export_mesh(mesh: trimesh.Trimesh, fmt: str) -> bytes:
    if fmt not in ("stl", "obj", "3mf", "glb"):
        raise MeshRejected("UNSUPPORTED_FORMAT", f"cannot export {fmt}")
    if fmt == "glb":
        mesh = mesh.copy()
        mesh.apply_transform(Z_UP_TO_Y_UP)
    out = mesh.export(file_type=fmt)
    return out if isinstance(out, (bytes, bytearray)) else out.encode()


def as_float64(m: trimesh.Trimesh) -> trimesh.Trimesh:
    return trimesh.Trimesh(vertices=np.asarray(m.vertices, dtype=np.float64), faces=np.asarray(m.faces), process=False)
