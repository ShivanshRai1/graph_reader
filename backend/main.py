from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
from database import engine, get_db, Base
from models import Curve, DataPoint, GraphImageMirror
from schemas import (
    CurveCreate,
    CurveResponse,
    CurveUpdate,
    DataPointCreate,
    DataPointResponse,
    GraphImageMirrorUpsert,
    GraphImageMirrorResponse,
    ScaleSuggestionResponse,
)
import json
import os
import re
import base64
import threading
import time
from pathlib import Path
from urllib.parse import quote
from sqlalchemy import inspect, text
import requests
from scale_suggestions import build_scale_suggestion

# Create tables
Base.metadata.create_all(bind=engine)


def ensure_optional_curve_columns():
    try:
        dialect_name = engine.dialect.name
        inspector = inspect(engine)
        existing_columns = {column["name"] for column in inspector.get_columns("curves")}

        # This project runs on MySQL in production; enforce LONGTEXT for base64 screenshots.
        if dialect_name == "mysql":
            with engine.begin() as connection:
                if "graph_image" not in existing_columns:
                    connection.execute(text("ALTER TABLE curves ADD COLUMN graph_image LONGTEXT"))
                else:
                    connection.execute(text("ALTER TABLE curves MODIFY COLUMN graph_image LONGTEXT"))
                if "discoveree_graph_id" not in existing_columns:
                    connection.execute(text("ALTER TABLE curves ADD COLUMN discoveree_graph_id VARCHAR(64)"))
            return

        if "graph_image" not in existing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE curves ADD COLUMN graph_image TEXT"))
        if "discoveree_graph_id" not in existing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE curves ADD COLUMN discoveree_graph_id VARCHAR(64)"))
    except Exception as error:
        print(f"[SchemaMigration] Optional curve column migration skipped: {error}")


ensure_optional_curve_columns()

MAX_GRAPH_IMAGE_MIRROR_CHARS = 1_500_000
BACKEND_DIR = Path(__file__).resolve().parent
TC_ROOT = BACKEND_DIR / "static" / "tc"
IMAGE_ROOT = BACKEND_DIR / "static" / "images"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def normalize_tc_part_number(part_number: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", str(part_number or "").strip().lower())
    if not safe:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid part number")
    return safe


def resolve_part_subdirectory(root: Path, part_number: str, *, missing_detail: str) -> Path:
    safe_part = normalize_tc_part_number(part_number)
    candidate = (root / safe_part).resolve()
    if root.resolve() not in candidate.parents and candidate != root.resolve():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid part number path")
    if candidate.is_dir():
        return candidate

    if root.is_dir():
        for child in root.iterdir():
            if not child.is_dir() or child.name.lower() != safe_part:
                continue
            resolved = child.resolve()
            if root.resolve() in resolved.parents:
                return resolved

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=missing_detail.format(safe_part=safe_part),
    )


def resolve_tc_part_dir(part_number: str) -> Path:
    return resolve_part_subdirectory(
        TC_ROOT,
        part_number,
        missing_detail="No TC files found for part '{safe_part}'",
    )


def resolve_tc_file_path(part_number: str, filename: str) -> Path:
    safe_name = Path(str(filename or "").strip()).name
    if not safe_name or safe_name != str(filename).strip() or ".." in safe_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")
    if not safe_name.lower().endswith(".tc"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .tc files are available")

    part_dir = resolve_tc_part_dir(part_number)
    file_path = (part_dir / safe_name).resolve()
    if part_dir.resolve() not in file_path.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename path")
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="TC file not found")
    return file_path


def resolve_image_part_dir(part_number: str) -> Path:
    return resolve_part_subdirectory(
        IMAGE_ROOT,
        part_number,
        missing_detail="No graph images found for part '{safe_part}'",
    )


def resolve_image_file_path(part_number: str, filename: str) -> Path:
    safe_name = Path(str(filename or "").strip()).name
    if not safe_name or safe_name != str(filename).strip() or ".." in safe_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")
    if Path(safe_name).suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image files are available (.png, .jpg, .jpeg, .webp, .gif)",
        )

    part_dir = resolve_image_part_dir(part_number)
    file_path = (part_dir / safe_name).resolve()
    if part_dir.resolve() not in file_path.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename path")
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return file_path


def image_media_type(file_path: Path) -> str:
    return IMAGE_MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream")


def normalize_mirror_graph_image(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    lower = raw.lower()
    if lower.startswith("data:") or lower.startswith("blob:"):
        return raw
    compact = raw.replace("\n", "").replace("\r", "").replace(" ", "")
    if len(compact) > 200 and re.fullmatch(r"[A-Za-z0-9+/=]+", compact):
        payload = compact.replace("data:image/png;base64,", "")
        return f"data:image/png;base64,{payload}"
    return ""


def decode_mirror_graph_image_to_png_bytes(value: Optional[str]) -> bytes:
    normalized = normalize_mirror_graph_image(value)
    if not normalized:
        return b""
    if normalized.lower().startswith("data:"):
        _, _, payload = normalized.partition(",")
        if not payload:
            return b""
        try:
            return base64.b64decode(payload, validate=False)
        except Exception:
            return b""
    try:
        return base64.b64decode(normalized, validate=False)
    except Exception:
        return b""


def resolve_mirror_graph_image_for_graph_id(db: Session, graph_id: str) -> Tuple[str, Optional[object]]:
    normalized_graph_id = str(graph_id or "").strip()
    if not normalized_graph_id:
        return "", None

    mirror = (
        db.query(GraphImageMirror)
        .filter(GraphImageMirror.discoveree_graph_id == normalized_graph_id)
        .first()
    )
    if mirror and normalize_mirror_graph_image(mirror.graph_image):
        return normalize_mirror_graph_image(mirror.graph_image), mirror.updated_at

    curve = (
        db.query(Curve)
        .filter(Curve.discoveree_graph_id == normalized_graph_id)
        .order_by(Curve.updated_at.desc(), Curve.id.desc())
        .first()
    )
    normalized_image = normalize_mirror_graph_image(curve.graph_image if curve else "")
    if normalized_image:
        return normalized_image, curve.updated_at if curve else None

    return "", None


def upsert_graph_image_mirror_record(db: Session, graph_id: str, graph_image: str) -> GraphImageMirror:
    normalized_graph_id = str(graph_id or "").strip()
    normalized_image = normalize_mirror_graph_image(graph_image)
    if not normalized_graph_id or not normalized_image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="graph_id and embeddable graph_image are required",
        )
    if len(normalized_image) > MAX_GRAPH_IMAGE_MIRROR_CHARS:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="graph_image exceeds mirror size limit",
        )

    mirror = (
        db.query(GraphImageMirror)
        .filter(GraphImageMirror.discoveree_graph_id == normalized_graph_id)
        .first()
    )
    if mirror:
        mirror.graph_image = normalized_image
    else:
        mirror = GraphImageMirror(
            discoveree_graph_id=normalized_graph_id,
            graph_image=normalized_image,
        )
        db.add(mirror)

    db.query(Curve).filter(Curve.discoveree_graph_id == normalized_graph_id).update(
        {Curve.graph_image: normalized_image},
        synchronize_session=False,
    )
    db.commit()
    db.refresh(mirror)
    return mirror


app = FastAPI(
    title="Graph Data Capture API",
    description="API for capturing and managing graph data points",
    version="1.0.0"
)

# Add CORS middleware for React frontend
def keep_db_alive():
    while True:
        try:
            db = next(get_db())
            db.execute(text('SELECT 1'))
            db.close()
        except Exception as e:
            print(f"[KeepAlive] DB ping failed: {e}")
        time.sleep(240)  # every 4 minutes

# Start keep-alive thread
threading.Thread(target=keep_db_alive, daemon=True).start()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://graph-capture.netlify.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/")
@app.head("/")
def read_root():
    return {"message": "Graph Capture API is running!", "version": "1.0.0"}

@app.get("/health")
@app.head("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/tc")
def list_tc_parts():
    """List part folders that have hosted .tc files."""
    if not TC_ROOT.is_dir():
        return {"parts": [], "tc_root": str(TC_ROOT)}

    parts = []
    for part_dir in sorted(TC_ROOT.iterdir(), key=lambda path: path.name.lower()):
        if not part_dir.is_dir():
            continue
        tc_files = sorted(part_dir.glob("*.tc"), key=lambda path: path.name.lower())
        if not tc_files:
            continue
        parts.append({
            "part_number": part_dir.name,
            "file_count": len(tc_files),
            "list_url": f"/api/tc/{part_dir.name}",
        })
    return {"parts": parts, "count": len(parts)}


@app.get("/api/tc/{part_number}")
def list_tc_files(part_number: str, request: Request):
    """List downloadable .tc files for a part number."""
    part_dir = resolve_tc_part_dir(part_number)
    base_url = str(request.base_url).rstrip("/")
    safe_part = part_dir.name

    files = []
    for file_path in sorted(part_dir.glob("*.tc"), key=lambda path: path.name.lower()):
        quoted_name = quote(file_path.name)
        files.append({
            "name": file_path.name,
            "size_bytes": file_path.stat().st_size,
            "view_url": f"{base_url}/api/tc/{safe_part}/{quoted_name}",
            "download_url": f"{base_url}/api/tc/{safe_part}/{quoted_name}?download=1",
            "url": f"{base_url}/api/tc/{safe_part}/{quoted_name}",
        })

    return {
        "part_number": safe_part,
        "count": len(files),
        "files": files,
    }


@app.get("/api/tc/{part_number}/{filename}")
def get_tc_file(part_number: str, filename: str, download: bool = False):
    """Serve a .tc file by part number and filename.

    Default: display JSON inline in the browser.
    Add ?download=1 to force a file download.
    """
    file_path = resolve_tc_file_path(part_number, filename)
    if download:
        return FileResponse(
            path=file_path,
            media_type="application/json",
            filename=file_path.name,
            content_disposition_type="attachment",
        )
    return FileResponse(
        path=file_path,
        media_type="application/json",
        content_disposition_type="inline",
    )


@app.get("/api/images")
def list_image_parts():
    """List part folders that have hosted graph images (PNG/JPEG/WebP/GIF)."""
    if not IMAGE_ROOT.is_dir():
        return {"parts": [], "image_root": str(IMAGE_ROOT)}

    parts = []
    for part_dir in sorted(IMAGE_ROOT.iterdir(), key=lambda path: path.name.lower()):
        if not part_dir.is_dir():
            continue
        image_files = [
            path
            for path in part_dir.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ]
        if not image_files:
            continue
        parts.append({
            "part_number": part_dir.name,
            "file_count": len(image_files),
            "list_url": f"/api/images/{part_dir.name}",
        })
    return {"parts": parts, "count": len(parts)}


@app.get("/api/images/{part_number}")
def list_image_files(part_number: str, request: Request):
    """List viewable graph images for a part number with shareable URLs."""
    part_dir = resolve_image_part_dir(part_number)
    base_url = str(request.base_url).rstrip("/")
    safe_part = part_dir.name

    files = []
    for file_path in sorted(part_dir.iterdir(), key=lambda path: path.name.lower()):
        if not file_path.is_file() or file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        quoted_name = quote(file_path.name)
        view_url = f"{base_url}/api/images/{safe_part}/{quoted_name}"
        files.append({
            "name": file_path.name,
            "size_bytes": file_path.stat().st_size,
            "media_type": image_media_type(file_path),
            "view_url": view_url,
            "download_url": f"{view_url}?download=1",
            "url": view_url,
        })

    return {
        "part_number": safe_part,
        "count": len(files),
        "files": files,
    }


@app.get("/api/images/{part_number}/{filename}")
def get_image_file(part_number: str, filename: str, download: bool = False):
    """Serve a graph image by part number and filename.

    Default: display inline in the browser (usable in <img src=\"...\">).
    Add ?download=1 to force a file download.
    """
    file_path = resolve_image_file_path(part_number, filename)
    media_type = image_media_type(file_path)
    if download:
        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=file_path.name,
            content_disposition_type="attachment",
        )
    return FileResponse(
        path=file_path,
        media_type=media_type,
        content_disposition_type="inline",
    )


@app.get("/api/debug/backend-ip")
def debug_backend_ip():
    """Debug endpoint to get the backend's outbound IP (on-demand, no blocking)"""
    try:
        response = requests.get('https://api.ipify.org?format=json', timeout=3)
        ip = response.json().get('ip', 'unknown')
        return {
            "backend_ip": ip,
            "info": "Use this IP to whitelist in DiscoverEE's Imunify360 settings",
            "endpoint": "https://www.discoveree.io/vision_upload.php"
        }
    except Exception as e:
        return {
            "backend_ip": "error",
            "error": str(e),
            "info": "Could not detect IP. Check Render dashboard instead."
        }


def parse_company_api_text(raw_text: str):
    stripped = (raw_text or "").strip()
    if re.fullmatch(r"\d+", stripped):
        graph_id = int(stripped)
        if graph_id > 0:
            return {"graph_id": graph_id}

    object_start = raw_text.find("{")
    array_start = raw_text.find("[")
    start_candidates = [index for index in [object_start, array_start] if index >= 0]
    if not start_candidates:
        raise ValueError("No JSON payload found in response text")
    match_start = min(start_candidates)

    object_end = raw_text.rfind("}")
    array_end = raw_text.rfind("]")
    end_candidates = [index for index in [object_end, array_end] if index >= 0]
    if not end_candidates:
        raise ValueError("No complete JSON payload found in response text")
    match_end = max(end_candidates)
    if match_end == -1 or match_end < match_start:
        raise ValueError("No complete JSON payload found in response text")

    return json.loads(raw_text[match_start:match_end + 1])


def has_valid_graph_id_in_result(result: dict) -> bool:
    parsed = result.get("response")
    raw_text = str(result.get("raw_text") or "")

    if isinstance(parsed, dict):
        graph_id = parsed.get("graph_id") or parsed.get("graphId")
        if graph_id is not None and str(graph_id).strip() != "":
            return True

    stripped = raw_text.strip()
    if re.fullmatch(r"\d+", stripped) and int(stripped) > 0:
        return True

    return bool(re.search(r'"graph_id"\s*:\s*"?\d+"?', raw_text, re.IGNORECASE))


def is_ai_provider_error(raw_text: str) -> bool:
    lower = str(raw_text or "").lower()
    return (
        "resource_exhausted" in lower
        or "quota exceeded" in lower
        or '"code": 429' in lower
        or '"code":429' in lower
    )


# Set False to test vision_upload.php only (no graph_capture_api.php fallback).
AI_EXTRACTION_USE_BACKUP_ENDPOINT = False


def should_use_backup_after_primary(primary_result: dict) -> bool:
    if has_valid_graph_id_in_result(primary_result):
        return False

    raw_text = str(primary_result.get("raw_text") or "")
    if is_ai_provider_error(raw_text):
        return False

    primary_content_type = str(primary_result.get("content_type") or "").lower()
    primary_response_is_html = "text/html" in primary_content_type
    primary_response_is_error_text = "Invalid base64 format" in raw_text
    primary_response_is_imunify_blocked = "imunify360" in raw_text.lower()

    return (
        primary_response_is_html
        or primary_response_is_error_text
        or primary_response_is_imunify_blocked
        or (
            not primary_result.get("upstream_ok")
            and int(primary_result.get("upstream_status") or 0) >= 500
            and not raw_text.strip()
        )
    )


def post_ai_extraction_to_company(target_url: str, normalized_payload: dict, send_as_json: bool = False):
    request_headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        # Ask for uncompressed body — gzip + wrong Content-Type can yield garbled vision_upload.php responses.
        "Accept-Encoding": "identity",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin": "https://graph-capture.netlify.app",
        "Referer": "https://graph-capture.netlify.app/",
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
    }

    # Log payload info
    base64_len = len(normalized_payload.get("base64image", ""))
    print(f"[DEBUG] POST to {target_url}: send_as_json={send_as_json}, base64image_length={base64_len}, payload_keys={list(normalized_payload.keys())}")

    if send_as_json:
        print(f"[DEBUG] Sending to {target_url} as JSON")
        response = requests.post(
            target_url,
            json=normalized_payload,
            timeout=120,
            headers=request_headers,
        )
    else:
        # Use files= to send multipart/form-data, matching browser FormData semantics.
        print(f"[DEBUG] Sending to {target_url} as multipart/form-data")
        multipart_fields = {key: (None, value) for key, value in normalized_payload.items()}
        response = requests.post(
            target_url,
            files=multipart_fields,
            timeout=120,
            headers=request_headers,
        )

    raw_text = response.text
    content_type = response.headers.get("Content-Type", "")
    print(f"[DEBUG] Response from {target_url}: Status={response.status_code} | Content-Type={content_type} | Length={len(raw_text)}")
    
    # If response is HTML, log full content
    if "text/html" in content_type.lower():
        print(f"[DEBUG] HTML Response (full): {raw_text[:2000]}")
    
    try:
        parsed_response = parse_company_api_text(raw_text)
    except Exception:
        parsed_response = raw_text

    print(f"[AI_EXTRACTION] URL: {target_url} | Status: {response.status_code} | RawText length: {len(raw_text)} | First 500 chars: {raw_text[:500]}")

    return {
        "target_url": target_url,
        "upstream_status": response.status_code,
        "upstream_ok": response.ok,
        "content_type": response.headers.get("Content-Type", ""),
        "response_headers": dict(response.headers),
        "raw_text": raw_text,
        "response": parsed_response,
    }


@app.post("/api/ai-extraction")
def relay_ai_extraction(payload: dict):
    normalized_payload = {
        str(key): "" if value is None else str(value)
        for key, value in (payload or {}).items()
    }
    if not normalized_payload.get("action"):
        normalized_payload["action"] = "graphcapture"

    base64image = str(normalized_payload.get("base64image") or "")
    base64image = re.sub(r"^data:[^;]+;base64,", "", base64image).strip()
    if not base64image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required field: base64image"
        )
    normalized_payload["base64image"] = base64image

    base64image = re.sub(r"[^A-Za-z0-9+/=]", "", base64image)
    normalized_payload["base64image"] = base64image

    primary_url = "https://www.discoveree.io/vision_upload.php"
    fallback_url = "https://www.discoveree.io/graph_capture_api.php"

    try:
        attempts = []

        primary_result = post_ai_extraction_to_company(primary_url, normalized_payload, send_as_json=False)
        attempts.append(primary_result)

        final_result = primary_result
        if AI_EXTRACTION_USE_BACKUP_ENDPOINT and should_use_backup_after_primary(primary_result):
            raw_text = str(primary_result.get("raw_text") or "")
            primary_content_type = str(primary_result.get("content_type") or "").lower()
            if "text/html" in primary_content_type:
                reason = "HTML response"
            elif "imunify360" in raw_text.lower():
                reason = "Imunify360 bot-protection blocked"
            elif "Invalid base64 format" in raw_text:
                reason = "Invalid base64 format"
            else:
                reason = "5xx error"
            print(f"[AI_EXTRACTION] PRIMARY FAILED ({reason}) - Using FALLBACK.")
            fallback_result = post_ai_extraction_to_company(fallback_url, normalized_payload, send_as_json=True)
            attempts.append(fallback_result)
            final_result = fallback_result
            print(f"[AI_EXTRACTION] FALLBACK RESULT. Final graph_id: {final_result.get('response', {}).get('graph_id', 'N/A')}")
        elif has_valid_graph_id_in_result(primary_result):
            print(f"[AI_EXTRACTION] PRIMARY SUCCEEDED. Final graph_id: {final_result.get('response', {}).get('graph_id', 'N/A')}")
        elif is_ai_provider_error(str(primary_result.get('raw_text') or '')):
            print("[AI_EXTRACTION] PRIMARY AI PROVIDER ERROR - skipping backup to avoid duplicate capture.")
        else:
            print("[AI_EXTRACTION] PRIMARY returned no graph_id - skipping backup (not a WAF block).")

        response_content = {
            **final_result,
            "attempts": attempts,
        }

        return JSONResponse(
            status_code=int(final_result.get("upstream_status") or status.HTTP_502_BAD_GATEWAY),
            content=response_content,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI extraction relay failed: {str(error)}"
        )

# ============= CURVE ENDPOINTS =============

@app.post("/api/curves", response_model=CurveResponse, status_code=status.HTTP_201_CREATED)
def create_curve(curve: CurveCreate, db: Session = Depends(get_db)):
    """Create a new curve with data points"""
    try:
        # Create curve
        db_curve = Curve(
            part_number=curve.part_number,
            curve_name=curve.curve_name,
            x_scale=curve.x_scale,
            y_scale=curve.y_scale,
            x_unit=curve.x_unit,
            y_unit=curve.y_unit,
            x_min=curve.x_min,
            x_max=curve.x_max,
            y_min=curve.y_min,
            y_max=curve.y_max,
            temperature=curve.temperature,
            manufacturer=curve.manufacturer,
            graph_title=curve.graph_title,
            x_label=curve.x_label,
            y_label=curve.y_label,
            other_symbols=curve.other_symbols,
            discoveree_cat_id=curve.discoveree_cat_id,
            discoveree_graph_id=curve.discoveree_graph_id,
            graph_image=curve.graph_image,
        )
        # Add data points
        for point in curve.data_points:
            db_point = DataPoint(
                x_value=point.x_value,
                y_value=point.y_value,
            )
            db_curve.data_points.append(db_point)
        db.add(db_curve)
        db.commit()
        db.refresh(db_curve)
        return db_curve
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error creating curve: {str(e)}"
        )

@app.get("/api/scale-suggestions", response_model=ScaleSuggestionResponse)
def get_scale_suggestions(
    graph_title: str = "",
    x_label: str = "",
    y_label: str = "",
    part_number: str = "",
    manufacturer: str = "",
    db: Session = Depends(get_db),
):
    """Suggest axis scales from similar past captures (informational only)."""
    try:
        return build_scale_suggestion(
            db,
            graph_title=graph_title,
            x_label=x_label,
            y_label=y_label,
            part_number=part_number,
            manufacturer=manufacturer,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error building scale suggestion: {str(e)}",
        )


@app.get("/api/curves", response_model=List[CurveResponse])
def list_curves(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Get all curves with pagination"""
    try:
        curves = db.query(Curve).offset(skip).limit(limit).all()
        return curves
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curves: {str(e)}"
        )

@app.get("/api/curves/{curve_id}", response_model=CurveResponse)
def get_curve(curve_id: int, db: Session = Depends(get_db)):
    """Get a specific curve by ID"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.get("/api/curves/by-discoveree/{discoveree_id}", response_model=Optional[CurveResponse])
def get_curve_by_discoveree_id(discoveree_id: int, db: Session = Depends(get_db)):
    """Get a specific curve by discoveree_cat_id"""
    try:
        curve = db.query(Curve).filter(Curve.discoveree_cat_id == discoveree_id).first()
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.get("/api/curves/by-graph/{graph_id}", response_model=Optional[CurveResponse])
def get_curve_by_graph_id(graph_id: str, db: Session = Depends(get_db)):
    """Get a specific curve by discoveree_graph_id (the graph_id URL param)"""
    try:
        curve = db.query(Curve).filter(Curve.discoveree_graph_id == str(graph_id)).first()
        return curve
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curve: {str(e)}"
        )

@app.get("/api/curves/all-by-graph/{graph_id}", response_model=List[CurveResponse])
def get_all_curves_by_graph_id(graph_id: str, db: Session = Depends(get_db)):
    """Get all curves for a discoveree_graph_id (supports multi-curve manual graphs)"""
    try:
        curves = (
            db.query(Curve)
            .filter(Curve.discoveree_graph_id == str(graph_id))
            .order_by(Curve.id.asc())
            .all()
        )
        return curves
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching curves: {str(e)}"
        )

@app.get("/api/graphs/{graph_id}/graph-image", response_model=GraphImageMirrorResponse)
def get_graph_image_mirror(graph_id: str, db: Session = Depends(get_db)):
    """Return mirrored graph image for a DiscoverEE graph_id (cross-browser reload fallback)."""
    normalized_graph_id = str(graph_id or "").strip()
    if not normalized_graph_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="graph_id is required")

    try:
        normalized_image, updated_at = resolve_mirror_graph_image_for_graph_id(db, normalized_graph_id)
        if normalized_image:
            return GraphImageMirrorResponse(
                graph_id=normalized_graph_id,
                graph_image=normalized_image,
                updated_at=updated_at,
            )

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mirrored graph image not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching mirrored graph image: {str(e)}",
        )


@app.get("/api/graphs/{graph_id}/graph-image.png")
def get_graph_image_mirror_png(graph_id: str, db: Session = Depends(get_db)):
    """Return mirrored graph image as a PNG file (use this URL directly in img src or browsers)."""
    normalized_graph_id = str(graph_id or "").strip()
    if not normalized_graph_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="graph_id is required")

    try:
        normalized_image, _ = resolve_mirror_graph_image_for_graph_id(db, normalized_graph_id)
        png_bytes = decode_mirror_graph_image_to_png_bytes(normalized_image)
        if not png_bytes:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mirrored graph image not found")

        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching mirrored graph image: {str(e)}",
        )


@app.put("/api/graphs/{graph_id}/graph-image", response_model=GraphImageMirrorResponse)
def put_graph_image_mirror(
    graph_id: str,
    payload: GraphImageMirrorUpsert,
    db: Session = Depends(get_db),
):
    """Store graph image keyed by DiscoverEE graph_id for reliable reload in any browser."""
    normalized_graph_id = str(graph_id or "").strip()
    if not normalized_graph_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="graph_id is required")

    try:
        mirror = upsert_graph_image_mirror_record(
            db,
            normalized_graph_id,
            payload.graph_image,
        )

        local_curve_id = payload.local_curve_id
        if local_curve_id:
            curve = db.query(Curve).filter(Curve.id == local_curve_id).first()
            if curve:
                curve.discoveree_graph_id = normalized_graph_id
                curve.graph_image = mirror.graph_image
                db.commit()
                db.refresh(mirror)

        return GraphImageMirrorResponse(
            graph_id=normalized_graph_id,
            graph_image=mirror.graph_image,
            updated_at=mirror.updated_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error saving mirrored graph image: {str(e)}",
        )


@app.put("/api/curves/{curve_id}", response_model=CurveResponse)
def update_curve(curve_id: int, curve_update: CurveUpdate, db: Session = Depends(get_db)):
    """Update a curve"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # # Update fields
        # update_data = curve_update.model_dump(exclude_unset=True)
        # for field, value in update_data.items():
        #     setattr(curve, field, value)
        # db.commit()
        # db.refresh(curve)
        # return curve
        return {"message": "Curve update disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error updating curve: {str(e)}"
        )

@app.put("/api/curves/{curve_id}/discoveree-id")
def update_discoveree_id(curve_id: int, discoveree_cat_id: int, db: Session = Depends(get_db)):
    """Update only the discoveree_cat_id field for a curve"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        curve.discoveree_cat_id = discoveree_cat_id
        db.commit()
        db.refresh(curve)
        return {"id": curve.id, "discoveree_cat_id": curve.discoveree_cat_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating discoveree_cat_id: {str(e)}"
        )

@app.delete("/api/curves/{curve_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_curve(curve_id: int, db: Session = Depends(get_db)):
    """Delete a curve and its data points"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # db.delete(curve)
        # db.commit()
        # return None
        return {"message": "Curve deletion disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting curve: {str(e)}"
        )

# ============= DATA POINT ENDPOINTS =============

@app.post("/api/curves/{curve_id}/points", response_model=DataPointResponse, status_code=status.HTTP_201_CREATED)
def add_data_point(curve_id: int, point: DataPointCreate, db: Session = Depends(get_db)):
    """Add a single data point to a curve"""
    try:
        # curve = db.query(Curve).filter(Curve.id == curve_id).first()
        # if not curve:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Curve not found"
        #     )
        # db_point = DataPoint(
        #     curve_id=curve_id,
        #     x_value=point.x_value,
        #     y_value=point.y_value,
        # )
        # db.add(db_point)
        # db.commit()
        # db.refresh(db_point)
        # return db_point
        return {"message": "Data point creation disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error adding data point: {str(e)}"
        )

@app.get("/api/curves/{curve_id}/points", response_model=List[DataPointResponse])
def get_data_points(curve_id: int, db: Session = Depends(get_db)):
    """Get all data points for a curve"""
    try:
        curve = db.query(Curve).filter(Curve.id == curve_id).first()
        if not curve:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Curve not found"
            )
        
        points = db.query(DataPoint).filter(DataPoint.curve_id == curve_id).all()
        return points
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching data points: {str(e)}"
        )

@app.delete("/api/points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_data_point(point_id: int, db: Session = Depends(get_db)):
    """Delete a specific data point"""
    try:
        # point = db.query(DataPoint).filter(DataPoint.id == point_id).first()
        # if not point:
        #     raise HTTPException(
        #         status_code=status.HTTP_404_NOT_FOUND,
        #         detail="Data point not found"
        #     )
        # db.delete(point)
        # db.commit()
        # return None
        return {"message": "Data point deletion disabled: DB write commented out."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting data point: {str(e)}"
        )