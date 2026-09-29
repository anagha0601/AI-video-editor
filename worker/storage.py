"""Object storage: Cloudflare R2 (S3 API) in production, a local folder in development.

Mirrors src/lib/storage.ts. Public URLs:
  local -> /api/files/<key>            (served by the Next.js app from STORAGE_DIR)
  r2    -> <R2_PUBLIC_URL>/<key>
Relative URLs that are not /api/files/ (e.g. /sample/voice.m4a) are read from the
web app's public/ folder when it's on disk, otherwise fetched from WEB_URL.
"""
from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from urllib.parse import unquote

import requests

ROOT = Path(__file__).resolve().parent.parent


def _driver() -> str:
    explicit = os.environ.get("STORAGE_DRIVER")
    if explicit:
        return explicit
    return "r2" if os.environ.get("R2_BUCKET") and os.environ.get("R2_ACCESS_KEY_ID") else "local"


def storage_dir() -> Path:
    return Path(os.environ.get("STORAGE_DIR") or ROOT / "storage").resolve()


def public_dir() -> Path:
    return Path(os.environ.get("PUBLIC_DIR") or ROOT / "public").resolve()


_s3 = None


def _client():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client(
            "s3",
            endpoint_url=os.environ.get("R2_ENDPOINT") or f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
    return _s3


def public_url(key: str) -> str:
    if _driver() == "local":
        return f"/api/files/{key}"
    return f"{os.environ['R2_PUBLIC_URL'].rstrip('/')}/{key}"


def put_file(key: str, path: Path, content_type: str) -> str:
    if _driver() == "local":
        dst = storage_dir() / key
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dst)
    else:
        _client().upload_file(str(path), os.environ["R2_BUCKET"], key, ExtraArgs={"ContentType": content_type})
    return public_url(key)


def _key_from_url(url: str) -> str | None:
    if url.startswith("/api/files/"):
        return unquote(url[len("/api/files/"):])
    base = (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/")
    if base and url.startswith(base + "/"):
        return unquote(url[len(base) + 1:])
    return None


def fetch(url: str, cache_dir: Path) -> str:
    """Return a local file path for any media URL used in a timeline."""
    key = _key_from_url(url)
    if key is not None and _driver() == "local":
        p = storage_dir() / key
        if p.exists():
            return str(p)
    if url.startswith("/") and key is None:
        p = public_dir() / url.lstrip("/")
        if p.exists():
            return str(p)
    cache_dir.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(url.split("?")[0])[1][:6]
    dst = cache_dir / (hashlib.sha1(url.encode()).hexdigest()[:16] + ext)
    if dst.exists():
        return str(dst)
    if key is not None and _driver() == "r2":
        _client().download_file(os.environ["R2_BUCKET"], key, str(dst))
        return str(dst)
    full = url if url.startswith("http") else os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/") + url
    with requests.get(full, stream=True, timeout=120, headers={"User-Agent": "ReelSmithWorker/1.0"}) as r:
        r.raise_for_status()
        with open(dst, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return str(dst)
