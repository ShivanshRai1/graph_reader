import re
from typing import Optional

from sqlalchemy.orm import Session

from models import Curve

PATTERN_LABELS = {
    "capacitance_vs_vr": "Capacitance vs reverse voltage (C–V)",
    "output_iv": "Output / transfer characteristics (I–V)",
    "rds_on_vs_vgs": "On-resistance vs gate voltage",
    "safe_operating_area": "Safe operating area (SOA)",
}


def _normalize_text(*parts: Optional[str]) -> str:
    combined = " ".join(str(part or "").strip() for part in parts if str(part or "").strip())
    return re.sub(r"\s+", " ", combined).strip().lower()


def classify_graph_pattern(
    graph_title: str = "",
    x_label: str = "",
    y_label: str = "",
) -> Optional[str]:
    combined = _normalize_text(graph_title, x_label, y_label)
    x_text = _normalize_text(x_label)
    y_text = _normalize_text(y_label)
    if not combined:
        return None

    has_capacitance = bool(
        re.search(r"\bcapacitance\b", combined)
        or re.search(r"\bc\s*\[", combined)
        or re.search(r"\[\s*pf", combined)
        or re.search(r"\bc\s+vs", combined)
    )
    has_voltage = bool(
        re.search(r"\breverse\s+voltage\b", combined)
        or re.search(r"\bvr\b", combined)
        or re.search(r"\bvoltage\b", combined)
        or re.search(r"\[\s*v\s*\]", combined)
    )
    if has_capacitance and has_voltage:
        return "capacitance_vs_vr"

    has_current = bool(
        re.search(r"\bcurrent\b", combined)
        or re.search(r"\[\s*ma\s*\]", combined)
        or re.search(r"\bi\s*\(", combined)
    )
    if re.search(r"\boutput\s+characteristic|\btransfer\s+characteristic|\bdrain\s+current\b|\bi\s*[-–]\s*v\b", combined):
        if has_voltage and has_current:
            return "output_iv"

    if re.search(r"\br\s*ds\s*\(?\s*on\s*\)?", combined) and re.search(
        r"\bv\s*gs\b|\bgate\s+voltage\b", combined
    ):
        return "rds_on_vs_vgs"

    if re.search(r"\bsafe\s+operating\s+area\b|\bsoa\b", combined):
        return "safe_operating_area"

    return None


def _scale_is_logarithmic(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() == "logarithmic"


def _majority_scale(values, min_ratio: float) -> Optional[str]:
    if not values:
        return None
    log_count = sum(1 for value in values if _scale_is_logarithmic(value))
    linear_count = len(values) - log_count
    if log_count / len(values) >= min_ratio:
        return "Logarithmic"
    if linear_count / len(values) >= min_ratio:
        return "Linear"
    return None


def build_scale_suggestion(
    db: Session,
    graph_title: str = "",
    x_label: str = "",
    y_label: str = "",
    part_number: str = "",
    manufacturer: str = "",
    sample_limit: int = 500,
    min_samples: int = 3,
    min_ratio: float = 0.7,
):
    pattern_id = classify_graph_pattern(graph_title, x_label, y_label)
    if not pattern_id:
        return {
            "suggestion": None,
            "pattern_id": None,
            "pattern_label": None,
            "sample_count": 0,
            "message": None,
        }

    curves = (
        db.query(Curve)
        .order_by(Curve.updated_at.desc(), Curve.id.desc())
        .limit(max(1, min(sample_limit, 2000)))
        .all()
    )
    matches = [
        curve
        for curve in curves
        if classify_graph_pattern(curve.graph_title, curve.x_label, curve.y_label) == pattern_id
    ]

    normalized_part = _normalize_text(part_number)
    if normalized_part:
        part_matches = [
            curve
            for curve in matches
            if normalized_part in _normalize_text(curve.part_number)
        ]
        if len(part_matches) >= min_samples:
            matches = part_matches

    sample_count = len(matches)
    if sample_count < min_samples:
        return {
            "suggestion": None,
            "pattern_id": pattern_id,
            "pattern_label": PATTERN_LABELS.get(pattern_id),
            "sample_count": sample_count,
            "message": None,
        }

    x_scale = _majority_scale([curve.x_scale for curve in matches], min_ratio)
    y_scale = _majority_scale([curve.y_scale for curve in matches], min_ratio)
    suggestion = {}
    if x_scale:
        suggestion["xScale"] = x_scale
    if y_scale:
        suggestion["yScale"] = y_scale

    if not suggestion:
        return {
            "suggestion": None,
            "pattern_id": pattern_id,
            "pattern_label": PATTERN_LABELS.get(pattern_id),
            "sample_count": sample_count,
            "message": None,
        }

    scale_parts = []
    if x_scale:
        x_log = sum(1 for curve in matches if _scale_is_logarithmic(curve.x_scale))
        scale_parts.append(f"X was {x_scale} in {x_log}/{sample_count} similar captures")
    if y_scale:
        y_log = sum(1 for curve in matches if _scale_is_logarithmic(curve.y_scale))
        scale_parts.append(f"Y was {y_scale} in {y_log}/{sample_count} similar captures")

    return {
        "suggestion": suggestion,
        "pattern_id": pattern_id,
        "pattern_label": PATTERN_LABELS.get(pattern_id),
        "sample_count": sample_count,
        "message": f"Based on {sample_count} similar past captures: {'; '.join(scale_parts)}.",
    }
