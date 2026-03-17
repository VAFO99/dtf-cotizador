import json
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

try:
    from solver_service.packing_solver import PackingSolverError, solve_packing_request
    SOLVER_IMPORT_ERROR = None
except ModuleNotFoundError as error:
    PackingSolverError = RuntimeError
    solve_packing_request = None
    SOLVER_IMPORT_ERROR = error


HOST = "127.0.0.1"
PORT = 3000


class PackingDevHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[packing-api] {self.address_string()} - {fmt % args}")

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        if self.path.rstrip("/") == "/api/packing/solve":
            self._send_json(200, {"ok": True, "service": "packing-solver", "runtime": "python-dev"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/packing/solve":
            self._send_json(404, {"error": "Not found"})
            return

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


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), PackingDevHandler)
    print(f"[packing-api] listening on http://{HOST}:{PORT}/api/packing/solve")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
