from __future__ import annotations

import argparse
import json
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .model import HatchPredictor
from .storage import DatasetStore, Sample


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "web"
STORE = DatasetStore(DATA_DIR / "dataset.json")
PREDICTOR = HatchPredictor(DATA_DIR / "model.json")


class HatchRequestHandler(BaseHTTPRequestHandler):
    server_version = "HatchPredictor/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif parsed.path == "/styles.css":
            self._serve_file(STATIC_DIR / "styles.css", "text/css; charset=utf-8")
        elif parsed.path == "/app.js":
            self._serve_file(STATIC_DIR / "app.js", "application/javascript; charset=utf-8")
        elif parsed.path == "/api/samples":
            samples = STORE.load()
            self._json({"samples": [sample.__dict__ for sample in samples]})
        elif parsed.path == "/api/stats":
            samples = STORE.load()
            self._json(PREDICTOR.summary(samples))
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/samples":
            self._add_sample()
        elif parsed.path == "/api/samples/bulk":
            self._add_bulk_samples()
        elif parsed.path == "/api/predict":
            self._predict()
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/samples":
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        sample_id = parse_qs(parsed.query).get("id", [""])[0]
        deleted, samples = STORE.delete(sample_id)
        if deleted:
            stats = PREDICTOR.train(samples)
            self._json({"deleted": True, "stats": stats.__dict__})
        else:
            self._json({"deleted": False, "error": "样本不存在"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _add_sample(self) -> None:
        try:
            payload = self._read_json()
            size = parse_number(payload.get("size"), "尺寸")
            weight = parse_number(payload.get("weight"), "重量")
            creature = parse_creature(payload.get("creature"))
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        added, sample, samples = STORE.add(size, weight, creature)
        stats = PREDICTOR.train(samples) if added else PREDICTOR.stats(samples)
        self._json(
            {
                "added": added,
                "sample": sample.__dict__,
                "message": "已添加并重新训练模型" if added else "重复三元组，未重复计入",
                "stats": stats.__dict__,
            }
        )

    def _add_bulk_samples(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", ""))
        added_count = 0
        duplicate_count = 0
        errors = []

        for line_number, line in enumerate(text.splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            try:
                size, weight, creature = parse_sample_line(line)
                added, _, _ = STORE.add(size, weight, creature)
                if added:
                    added_count += 1
                else:
                    duplicate_count += 1
            except ValueError as exc:
                errors.append({"line": line_number, "error": str(exc), "content": line})

        samples = STORE.load()
        stats = PREDICTOR.train(samples)
        self._json(
            {
                "added_count": added_count,
                "duplicate_count": duplicate_count,
                "errors": errors,
                "stats": stats.__dict__,
            }
        )

    def _predict(self) -> None:
        try:
            payload = self._read_json()
            size = parse_number(payload.get("size"), "尺寸")
            weight = parse_number(payload.get("weight"), "重量")
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        samples = STORE.load()
        results = PREDICTOR.predict(samples, size, weight)
        self._json({"results": results, "stats": PREDICTOR.stats(samples).__dict__})

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        if not raw:
            return {}
        return json.loads(raw)

    def _serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._json({"error": "File not found"}, HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_number(value: object, label: str) -> float:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{label}必须是数字")
    if not number > 0:
        raise ValueError(f"{label}必须大于 0")
    return number


def parse_creature(value: object) -> str:
    creature = str(value or "").strip()
    if not creature:
        raise ValueError("精灵名称不能为空")
    return creature


def parse_sample_line(line: str) -> tuple[float, float, str]:
    parts = [part for part in re.split(r"[\s,，]+", line.strip(), maxsplit=2) if part]
    if len(parts) != 3:
        raise ValueError("格式应为：尺寸 重量 精灵")
    return parse_number(parts[0], "尺寸"), parse_number(parts[1], "重量"), parse_creature(parts[2])


def ensure_bootstrap_files() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not (DATA_DIR / "dataset.json").exists():
        (DATA_DIR / "dataset.json").write_text("[]", encoding="utf-8")
    PREDICTOR.train(STORE.load())


def main() -> None:
    parser = argparse.ArgumentParser(description="Rock Kingdom World Hatch Prediction System")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()

    ensure_bootstrap_files()
    server = ThreadingHTTPServer((args.host, args.port), HatchRequestHandler)
    print(f"孵蛋预测系统已启动：http://{args.host}:{args.port}")
    print("按 Ctrl+C 停止服务")
    server.serve_forever()


if __name__ == "__main__":
    main()
