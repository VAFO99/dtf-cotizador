from collections import defaultdict

from ortools.sat.python import cp_model


class PackingSolverError(RuntimeError):
    pass


SCALE = 100


def _num(value, fallback=0.0):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


def _scaled(value):
    return int(round(_num(value, 0.0) * SCALE))


def _clean_text(value, fallback=""):
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def solve_packing_request(payload):
    request = _normalize_request(payload)
    if not request["pieces"]:
        return {
            "objective": request["objective"],
            "source": "cp_sat",
            "status": "optimal",
            "sheetsUsed": 0,
            "totalCost": 0,
            "bins": [],
            "placements": [],
            "unplaced": [],
        }

    grouped_pieces = _group_pieces(request["pieces"], request["separateByGroup"])
    group_timeout_ms = max(500, int(request["timeoutMs"] / max(1, len(grouped_pieces))))

    all_bins = []
    all_unplaced = []
    statuses = []
    total_cost = 0

    for group_key, pieces in grouped_pieces.items():
        solution = _solve_group(
            pieces=pieces,
            sheet_types=request["sheetTypes"],
            objective=request["objective"],
            timeout_ms=group_timeout_ms,
            group_key=group_key,
            bin_offset=len(all_bins),
        )
        all_bins.extend(solution["bins"])
        all_unplaced.extend(solution["unplaced"])
        statuses.append(solution["status"])
        total_cost += solution["totalCost"]

    placements = [placement for bin_data in all_bins for placement in bin_data["placements"]]
    return {
        "objective": request["objective"],
        "source": "cp_sat",
        "status": _merge_statuses(statuses, all_unplaced),
        "sheetsUsed": len(all_bins),
        "totalCost": round(total_cost, 2),
        "bins": all_bins,
        "placements": placements,
        "unplaced": all_unplaced,
    }


def _normalize_request(payload):
    if not isinstance(payload, dict):
        raise PackingSolverError("El payload del solver debe ser un objeto JSON.")

    pieces = []
    for index, piece in enumerate(payload.get("pieces", [])):
        width = _num(piece.get("width"), 0)
        height = _num(piece.get("height"), 0)
        if width <= 0 or height <= 0:
            continue
        pieces.append({
            "id": _clean_text(piece.get("id"), f"piece-{index + 1}"),
            "width": width,
            "height": height,
            "canRotate": piece.get("canRotate", True) is not False,
            "label": _clean_text(piece.get("label"), f"Pieza {index + 1}"),
            "color": _clean_text(piece.get("color"), "#888888"),
            "groupKey": piece.get("groupKey"),
            "meta": piece.get("meta") if isinstance(piece.get("meta"), dict) else {},
        })

    sheet_types = []
    for index, sheet in enumerate(payload.get("sheetTypes", [])):
        width = _num(sheet.get("width"), 0)
        height = _num(sheet.get("height"), 0)
        if width <= 0 or height <= 0:
            continue
        sheet_types.append({
            "id": _clean_text(sheet.get("id"), f"sheet-{index + 1}"),
            "name": _clean_text(sheet.get("name"), f"Hoja {index + 1}"),
            "width": width,
            "height": height,
            "cost": _num(sheet.get("cost"), 0),
            "padding": _num(sheet.get("padding"), 0.25),
            "edge": _num(sheet.get("edge"), 0.15),
            "usableWidth": width - (_num(sheet.get("edge"), 0.15) * 2),
            "usableHeight": height - (_num(sheet.get("edge"), 0.15) * 2),
        })

    if not sheet_types:
        raise PackingSolverError("No hay hojas válidas para resolver el nesting.")

    return {
        "objective": _clean_text(payload.get("objective"), "min_sheets_then_cost"),
        "separateByGroup": bool(payload.get("separateByGroup")),
        "timeoutMs": max(500, int(_num(payload.get("timeoutMs"), 3500))),
        "pieces": pieces,
        "sheetTypes": sheet_types,
    }


def _group_pieces(pieces, separate_by_group):
    if not separate_by_group:
        return {"default": list(pieces)}

    grouped = defaultdict(list)
    for piece in pieces:
        grouped[_clean_text(piece.get("groupKey"), "default")].append(piece)
    return grouped


def _piece_fits(piece, sheet_type):
    usable_width = sheet_type["usableWidth"]
    usable_height = sheet_type["usableHeight"]
    fits_default = piece["width"] <= usable_width + 0.005 and piece["height"] <= usable_height + 0.005
    fits_rotated = (
        piece["canRotate"]
        and piece["height"] <= usable_width + 0.005
        and piece["width"] <= usable_height + 0.005
    )
    return fits_default or fits_rotated


def _solve_group(pieces, sheet_types, objective, timeout_ms, group_key, bin_offset):
    placeable = []
    unplaced = []

    for piece in pieces:
        if any(_piece_fits(piece, sheet_type) for sheet_type in sheet_types):
            placeable.append(piece)
        else:
            unplaced.append(_serialize_unplaced(piece, group_key))

    if not placeable:
        return {
            "status": "partial" if unplaced else "optimal",
            "bins": [],
            "unplaced": unplaced,
            "totalCost": 0,
        }

    phase1_timeout = max(0.2, timeout_ms / 2000)
    phase2_timeout = max(0.2, timeout_ms / 2000)

    phase1 = _run_phase(
        pieces=placeable,
        sheet_types=sheet_types,
        objective="min_sheets",
        timeout_seconds=phase1_timeout,
        fixed_used_count=None,
        fixed_total_cost_scaled=None,
    )

    if phase1 is None:
        raise PackingSolverError("El solver exacto no encontró una solución factible.")

    phase2 = _run_phase(
        pieces=placeable,
        sheet_types=sheet_types,
        objective="min_cost",
        timeout_seconds=phase2_timeout,
        fixed_used_count=phase1["sheetsUsed"],
        fixed_total_cost_scaled=None,
    )

    phase3 = None
    if phase2 is not None:
        phase3 = _run_phase(
            pieces=placeable,
            sheet_types=sheet_types,
            objective="compact_height",
            timeout_seconds=max(0.2, timeout_ms / 2000),
            fixed_used_count=phase1["sheetsUsed"],
            fixed_total_cost_scaled=phase2["totalCostScaled"],
        )

    chosen = phase3 or phase2 or phase1
    bins = []
    for bin_data in chosen["bins"]:
        bin_index = bin_offset + len(bins)
        bins.append({
            "binId": f"bin-{bin_index + 1}",
            "binIndex": bin_index,
            "groupKey": None if group_key == "default" else group_key,
            "sheet": bin_data["sheet"],
            "placements": [
                {
                    **placement,
                    "binId": f"bin-{bin_index + 1}",
                    "groupKey": None if group_key == "default" else group_key,
                }
                for placement in bin_data["placements"]
            ],
        })

    status = "optimal"
    if (
        phase2 is None
        or phase3 is None
        or phase1["status"] != "optimal"
        or phase2["status"] != "optimal"
        or phase3["status"] != "optimal"
    ):
        status = "timeout"
    if unplaced:
        status = "partial" if status == "optimal" else status

    return {
        "status": status,
        "bins": bins,
        "unplaced": unplaced,
        "totalCost": chosen["totalCost"],
    }


def _run_phase(pieces, sheet_types, objective, timeout_seconds, fixed_used_count, fixed_total_cost_scaled):
    model = cp_model.CpModel()
    slot_count = len(pieces)
    used = [model.NewBoolVar(f"used_{slot}") for slot in range(slot_count)]
    slot_types = {}
    active = {}
    x_vars = {}
    y_vars = {}
    x_intervals = [[] for _ in range(slot_count)]
    y_intervals = [[] for _ in range(slot_count)]
    cost_terms = []
    cost_scale = 100

    scaled_sheets = [
        {
            **sheet,
            "scaledUsableWidth": _scaled(sheet["usableWidth"]),
            "scaledUsableHeight": _scaled(sheet["usableHeight"]),
            "scaledWidth": _scaled(sheet["width"]),
            "scaledHeight": _scaled(sheet["height"]),
            "scaledEdge": _scaled(sheet["edge"]),
            "scaledPadding": _scaled(sheet["padding"]),
            "scaledCost": int(round(sheet["cost"] * cost_scale)),
        }
        for sheet in sheet_types
    ]

    for slot in range(slot_count):
        slot_bools = []
        for sheet_index, sheet in enumerate(scaled_sheets):
            slot_type = model.NewBoolVar(f"slot_{slot}_sheet_{sheet_index}")
            slot_types[(slot, sheet_index)] = slot_type
            slot_bools.append(slot_type)
            cost_terms.append(slot_type * sheet["scaledCost"])
        model.Add(sum(slot_bools) == used[slot])
        if slot < slot_count - 1:
            model.Add(used[slot] >= used[slot + 1])

    for piece_index, piece in enumerate(pieces):
        assignments = []
        scaled_width = _scaled(piece["width"])
        scaled_height = _scaled(piece["height"])

        for slot in range(slot_count):
            for sheet_index, sheet in enumerate(scaled_sheets):
                orientations = [(scaled_width, scaled_height, False)]
                if (
                    piece["canRotate"]
                    and (scaled_width != scaled_height)
                    and scaled_height <= sheet["scaledUsableWidth"]
                    and scaled_width <= sheet["scaledUsableHeight"]
                ):
                    orientations.append((scaled_height, scaled_width, True))

                for orientation_index, (ow, oh, rotated) in enumerate(orientations):
                    padded_width = ow + sheet["scaledPadding"]
                    padded_height = oh + sheet["scaledPadding"]
                    if padded_width > sheet["scaledUsableWidth"] or padded_height > sheet["scaledUsableHeight"]:
                        continue

                    present = model.NewBoolVar(
                        f"piece_{piece_index}_slot_{slot}_sheet_{sheet_index}_rot_{orientation_index}"
                    )
                    active[(piece_index, slot, sheet_index, orientation_index)] = (present, rotated, ow, oh)
                    assignments.append(present)
                    model.Add(present <= slot_types[(slot, sheet_index)])

                    x_start = model.NewIntVar(0, sheet["scaledUsableWidth"] - padded_width, f"x_{piece_index}_{slot}_{sheet_index}_{orientation_index}")
                    y_start = model.NewIntVar(0, sheet["scaledUsableHeight"] - padded_height, f"y_{piece_index}_{slot}_{sheet_index}_{orientation_index}")
                    x_end = model.NewIntVar(padded_width, sheet["scaledUsableWidth"], f"xe_{piece_index}_{slot}_{sheet_index}_{orientation_index}")
                    y_end = model.NewIntVar(padded_height, sheet["scaledUsableHeight"], f"ye_{piece_index}_{slot}_{sheet_index}_{orientation_index}")
                    model.Add(x_end == x_start + padded_width)
                    model.Add(y_end == y_start + padded_height)

                    x_vars[(piece_index, slot, sheet_index, orientation_index)] = x_start
                    y_vars[(piece_index, slot, sheet_index, orientation_index)] = y_start
                    x_intervals[slot].append(model.NewOptionalIntervalVar(x_start, padded_width, x_end, present, f"xint_{piece_index}_{slot}_{sheet_index}_{orientation_index}"))
                    y_intervals[slot].append(model.NewOptionalIntervalVar(y_start, padded_height, y_end, present, f"yint_{piece_index}_{slot}_{sheet_index}_{orientation_index}"))

        if not assignments:
            return None
        model.Add(sum(assignments) == 1)

    for slot in range(slot_count):
        model.AddNoOverlap2D(x_intervals[slot], y_intervals[slot])

    used_count = sum(used)
    total_cost_scaled = sum(cost_terms)
    if fixed_used_count is not None:
        model.Add(used_count == fixed_used_count)
    if fixed_total_cost_scaled is not None:
        model.Add(total_cost_scaled == fixed_total_cost_scaled)

    if objective == "min_sheets":
        model.Minimize(used_count)
    elif objective == "min_cost":
        model.Minimize(total_cost_scaled)
    elif objective == "compact_height":
        max_slot_height = max(sheet["scaledUsableHeight"] for sheet in scaled_sheets)
        slot_bottoms = []
        for slot in range(slot_count):
            slot_bottom = model.NewIntVar(0, max_slot_height, f"slot_bottom_{slot}")
            model.Add(slot_bottom <= used[slot] * max_slot_height)
            for piece_index, _piece in enumerate(pieces):
                for sheet_index, _sheet in enumerate(scaled_sheets):
                    for orientation_index in (0, 1):
                        state = active.get((piece_index, slot, sheet_index, orientation_index))
                        if not state:
                            continue
                        present, _rotated, _ow, oh = state
                        model.Add(slot_bottom >= y_vars[(piece_index, slot, sheet_index, orientation_index)] + oh).OnlyEnforceIf(present)
            slot_bottoms.append(slot_bottom)
        model.Minimize(sum(slot_bottoms))
    else:
        raise PackingSolverError(f"Objetivo no soportado: {objective}")

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = timeout_seconds
    solver.parameters.num_search_workers = 8

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    bins = []
    total_cost = 0

    for slot in range(slot_count):
        if solver.Value(used[slot]) != 1:
            continue

        sheet_index = next(
            index for index in range(len(scaled_sheets))
            if solver.Value(slot_types[(slot, index)]) == 1
        )
        sheet = sheet_types[sheet_index]
        placements = []
        total_cost += sheet["cost"]

        for piece_index, piece in enumerate(pieces):
            for orientation_index in (0, 1):
                state = active.get((piece_index, slot, sheet_index, orientation_index))
                if not state:
                    continue
                present, rotated, ow, oh = state
                if solver.Value(present) != 1:
                    continue

                x_start = solver.Value(x_vars[(piece_index, slot, sheet_index, orientation_index)]) / SCALE
                y_start = solver.Value(y_vars[(piece_index, slot, sheet_index, orientation_index)]) / SCALE
                placements.append({
                    "pieceId": piece["id"],
                    "label": piece["label"],
                    "color": piece["color"],
                    "x": round(x_start + sheet["edge"], 2),
                    "y": round(y_start + sheet["edge"], 2),
                    "width": round(ow / SCALE, 2),
                    "height": round(oh / SCALE, 2),
                    "rotated": rotated,
                    "meta": piece["meta"],
                })

        bins.append({
            "sheet": {
                "id": sheet["id"],
                "name": sheet["name"],
                "width": sheet["width"],
                "height": sheet["height"],
                "cost": sheet["cost"],
                "padding": sheet["padding"],
                "edge": sheet["edge"],
            },
            "placements": placements,
        })

    return {
        "status": "optimal" if status == cp_model.OPTIMAL else "timeout",
        "sheetsUsed": len(bins),
        "totalCost": round(total_cost, 2),
        "totalCostScaled": int(round(total_cost * cost_scale)),
        "bins": bins,
    }


def _serialize_unplaced(piece, group_key):
    return {
        "pieceId": piece["id"],
        "label": piece["label"],
        "color": piece["color"],
        "width": piece["width"],
        "height": piece["height"],
        "canRotate": piece["canRotate"],
        "groupKey": None if group_key == "default" else group_key,
        "meta": piece["meta"],
    }


def _merge_statuses(statuses, unplaced):
    if any(status == "timeout" for status in statuses):
        return "timeout"
    if unplaced:
        return "partial"
    return "optimal"
