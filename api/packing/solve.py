import json
import os
from http.server import BaseHTTPRequestHandler

try:
    from solver_service.packing_solver import PackingSolverError, solve_packing_request
    SOLVER_IMPORT_ERROR = None
except ModuleNotFoundError as error:  # pragma: no cover - depends on deployment env
    PackingSolverError = RuntimeError
    solve_packing_request = None
    SOLVER_IMPORT_ERROR = error


def _get_allowed_origins():
    origins = {
        "http://localhost:5173",
        "http://localhost:3000",
    }
    env_origins = os.environ.get("ALLOWED_ORIGINS")
    if env_origins:
        for o in env_origins.split(","):
            origins.add(o.strip())
    return origins


ALLOWED_ORIGINS = _get_allowed_origins()


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")

        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)

        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        self._send_json(200, {"ok": True, "service": "packing-solver", "runtime": "python"})

    def do_POST(self):
        try:
            if SOLVER_IMPORT_ERROR is not None or solve_packing_request is None:
                raise ModuleNotFoundError(str(SOLVER_IMPORT_ERROR or "ortools"))
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
            result = solve_packing_request(payload)
            self._send_json(200, result)
        except ModuleNotFoundError as error:
            self._send_json(503, {
                "error": f"Dependencia faltante para el solver exacto: {error}",
                "source": "cp_sat",
                "status": "unavailable",
            })
        except PackingSolverError as error:
            self._send_json(400, {
                "error": str(error),
                "source": "cp_sat",
                "status": "invalid_request",
            })
        except Exception as error:
            self._send_json(500, {
                "error": f"Error interno del solver exacto: {error}",
                "source": "cp_sat",
                "status": "error",
            })
