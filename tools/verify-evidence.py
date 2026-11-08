#!/usr/bin/env python3
"""Verify hashes inside a Bonfire evidence ZIP, using only Python standard library.
SHA-256 can detect later changes, but is NOT a trusted cryptographic signature.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import PurePosixPath


def verify(filename):
    with zipfile.ZipFile(filename) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("ZIP contains duplicate entry names")
        bad = archive.testzip()
        if bad:
            raise ValueError(f"CRC integrity failure: {bad}")
        manifest_name = "bonfire-evidence/manifest.json"
        if manifest_name not in names:
            raise ValueError("Missing evidence manifest")
        manifest = json.loads(archive.read(manifest_name))
        files = manifest.get("files", [])
        for item in files:
            name = item["path"]
            if not name.startswith("bonfire-evidence/") or ".." in PurePosixPath(name).parts:
                raise ValueError(f"Unsafe manifest entry: {name}")
            if name not in names:
                raise ValueError(f"Missing archive entry: {name}")
            data = archive.read(name)
            digest = hashlib.sha256(data).hexdigest()
            if digest != item["sha256"] or len(data) != item["bytes"]:
                raise ValueError(f"SHA-256 or size mismatch: {name}")
        print(f"PASS: {len(files)} files match SHA-256, and ZIP CRC checks pass")
        print("Export timestamp:", manifest.get("exported_at_utc"))
        print("Messages:", manifest.get("message_count"))
        print("Missing/expired attachments:", len(manifest.get("attachments_missing", [])))
        print("Note: checksums do not prove who created the archive or that the source was authentic.")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit("Usage: python verify-evidence.py <bonfire-evidence.zip>")
    try:
        verify(sys.argv[1])
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        sys.exit("FAIL: " + str(error))
