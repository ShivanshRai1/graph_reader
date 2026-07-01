import re
import statistics
from typing import Optional

from sqlalchemy.orm import Session

from models import Curve

PATTERN_LABELS = {
    "capacitance_vs_vr": "Capacitance vs reverse voltage (C–V)",
    "forward_if_vs_vf": "Forward current vs forward voltage (IF vs VF)",
    "output_iv": "Output / transfer characteristics (I–V)",
    "rds_on_vs_vgs": "On-resistance vs gate voltage",
    "gate_charge_vs_vgs": "Gate charge vs gate voltage (Qg vs Vgs)",
    "safe_operating_area": "Safe operating area (SOA)",
}


def _normalize_part(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""

    cleaned = re.sub(
        r"^[\s_./\\|,;:!@#$%^&*+=~`\"'<>[\]{}-–—]+|[\s_./\\|,;:!@#$%^&*+=~`\"'<>[\]{}-–—]+$",
        "",
        cleaned,
    )
    cleaned = re.sub(r"[_/\\|,;:!@#$%^&*+=~`\"'<>{}]+", " ", cleaned)
    cleaned = cleaned.replace("–", "-").replace("—", "-")
    cleaned = re.sub(r"(?<!\d)-(?!\d)", " - ", cleaned)
    cleaned = re.sub(r"(?<!\d)\.(?!\d)", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_text(*parts: Optional[str]) -> str:
    combined = " ".join(
        _normalize_part(part) for part in parts if _normalize_part(part)
    )
    return re.sub(r"\s+", " ", combined).strip().lower()


def classify_graph_pattern(
    graph_title: str = "",
    x_label: str = "",
    y_label: str = "",
) -> Optional[str]:
    combined = _normalize_text(graph_title, x_label, y_label)
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
        or re.search(r"\bv\s*ds\b", combined)
        or re.search(r"\bvgs\b", combined)
        or re.search(r"\bgate\s+voltage\b", combined)
    )
    if has_capacitance and has_voltage:
        return "capacitance_vs_vr"

    has_gate_charge = bool(
        re.search(r"\bgate\s+charge\b", combined)
        or re.search(r"\bqg\b", combined)
        or re.search(r"\bq\s*g\b", combined)
    )
    has_gate_voltage = bool(
        re.search(r"\bvgs\b", combined)
        or re.search(r"\bgate\s+voltage\b", combined)
    )
    if has_gate_charge and has_gate_voltage:
        return "gate_charge_vs_vgs"

    has_forward_voltage = bool(
        re.search(r"\bforward\s+voltage\b", combined)
        or re.search(r"\bvf\b", combined)
        or re.search(r"\bvf\s*\[", combined)
    )
    has_forward_current = bool(
        re.search(r"\bforward\s+current\b", combined)
        or re.search(r"\bif\b", combined)
        or re.search(r"\bif\s*\[", combined)
    )
    if has_forward_current and has_forward_voltage:
        return "forward_if_vs_vf"
    if re.search(r"\bif\s+vs\.?\s*vf\b", combined):
        return "forward_if_vs_vf"

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


def _majority_value(values, min_ratio: float = 0.6) -> Optional[str]:
    if not values:
        return None
    counts = {}
    for value in values:
        key = str(value or "").strip()
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None
    best_key, best_count = max(counts.items(), key=lambda item: item[1])
    if best_count / len(values) >= min_ratio:
        return best_key
    return None


def _is_placeholder_bounds(curve: Curve) -> bool:
    if _scale_is_logarithmic(curve.x_scale) or _scale_is_logarithmic(curve.y_scale):
        return False
    try:
        return (
            float(curve.x_min) == 0
            and float(curve.x_max) == 100
            and float(curve.y_min) == 0
            and float(curve.y_max) == 100
        )
    except (TypeError, ValueError):
        return False


def _curve_has_valid_bounds(curve: Curve) -> bool:
    try:
        x_min = float(curve.x_min)
        x_max = float(curve.x_max)
        y_min = float(curve.y_min)
        y_max = float(curve.y_max)
    except (TypeError, ValueError):
        return False

    if x_max <= x_min or y_max <= y_min:
        return False
    if _scale_is_logarithmic(curve.x_scale) and (x_min <= 0 or x_max <= 0):
        return False
    if _scale_is_logarithmic(curve.y_scale) and (y_min <= 0 or y_max <= 0):
        return False
    return not _is_placeholder_bounds(curve)


def _median_axis_value(values) -> Optional[float]:
    nums = []
    for value in values:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        if parsed == parsed:  # NaN check
            nums.append(parsed)
    if not nums:
        return None
    return float(statistics.median(nums))


def _format_axis_bound(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    if value == 0:
        return "0"
    abs_value = abs(value)
    if abs_value >= 1000 or (abs_value > 0 and abs_value < 0.001):
        return format(value, ".12g")
    if float(int(value)) == value:
        return str(int(value))
    return format(value, ".12g")


def build_scale_suggestion(
    db: Session,
    graph_title: str = "",
    x_label: str = "",
    y_label: str = "",
    part_number: str = "",
    manufacturer: str = "",
    sample_limit: int = 500,
    min_samples: int = 2,
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

    bound_matches = [curve for curve in matches if _curve_has_valid_bounds(curve)]
    bound_source = bound_matches if len(bound_matches) >= min_samples else matches

    x_scale = _majority_scale([curve.x_scale for curve in matches], min_ratio)
    y_scale = _majority_scale([curve.y_scale for curve in matches], min_ratio)
    x_unit = _majority_value([curve.x_unit for curve in matches], min_ratio)
    y_unit = _majority_value([curve.y_unit for curve in matches], min_ratio)

    x_min = _median_axis_value([curve.x_min for curve in bound_source])
    x_max = _median_axis_value([curve.x_max for curve in bound_source])
    y_min = _median_axis_value([curve.y_min for curve in bound_source])
    y_max = _median_axis_value([curve.y_max for curve in bound_source])

    reference = matches[0]
    suggestion = {}
    if x_scale:
        suggestion["xScale"] = x_scale
    if y_scale:
        suggestion["yScale"] = y_scale
    if x_unit:
        suggestion["xUnitPrefix"] = x_unit
    if y_unit:
        suggestion["yUnitPrefix"] = y_unit

    formatted_x_min = _format_axis_bound(x_min)
    formatted_x_max = _format_axis_bound(x_max)
    formatted_y_min = _format_axis_bound(y_min)
    formatted_y_max = _format_axis_bound(y_max)
    if formatted_x_min is not None and formatted_x_max is not None and x_max > x_min:
        suggestion["xMin"] = formatted_x_min
        suggestion["xMax"] = formatted_x_max
    if formatted_y_min is not None and formatted_y_max is not None and y_max > y_min:
        suggestion["yMin"] = formatted_y_min
        suggestion["yMax"] = formatted_y_max

    if reference.part_number:
        suggestion["referencePartNumber"] = str(reference.part_number).strip()
    if reference.id:
        suggestion["referenceCurveId"] = reference.id
    if reference.discoveree_graph_id:
        suggestion["referenceGraphId"] = str(reference.discoveree_graph_id).strip()

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

    bounds_part = None
    if suggestion.get("xMin") and suggestion.get("xMax") and suggestion.get("yMin") and suggestion.get("yMax"):
        bounds_part = (
            f"typical axis X [{suggestion['xMin']}, {suggestion['xMax']}], "
            f"Y [{suggestion['yMin']}, {suggestion['yMax']}]"
        )

    ref_part = suggestion.get("referencePartNumber")
    ref_clause = f" (example: {ref_part})" if ref_part else ""
    message_parts = [f"Based on {sample_count} similar past captures{ref_clause}"]
    if scale_parts:
        message_parts.append("; ".join(scale_parts))
    if bounds_part:
        message_parts.append(bounds_part)

    return {
        "suggestion": suggestion,
        "pattern_id": pattern_id,
        "pattern_label": PATTERN_LABELS.get(pattern_id),
        "sample_count": sample_count,
        "message": ". ".join(part for part in message_parts if part) + ".",
    }
