from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from .storage import Sample


@dataclass(frozen=True)
class ModelStats:
    sample_count: int
    class_count: int
    size_mean: float
    weight_mean: float
    size_std: float
    weight_std: float
    classes: list[str]


class HatchPredictor:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self.model_path.parent.mkdir(parents=True, exist_ok=True)

    def train(self, samples: list[Sample]) -> ModelStats:
        if not samples:
            stats = ModelStats(0, 0, 0.0, 0.0, 1.0, 1.0, [])
            self._save_stats(stats)
            return stats

        size_mean = sum(sample.size for sample in samples) / len(samples)
        weight_mean = sum(sample.weight for sample in samples) / len(samples)
        size_std = self._std([sample.size for sample in samples], size_mean)
        weight_std = self._std([sample.weight for sample in samples], weight_mean)
        classes = sorted({sample.creature for sample in samples})
        stats = ModelStats(
            sample_count=len(samples),
            class_count=len(classes),
            size_mean=size_mean,
            weight_mean=weight_mean,
            size_std=size_std,
            weight_std=weight_std,
            classes=classes,
        )
        self._save_stats(stats)
        return stats

    def stats(self, samples: list[Sample]) -> ModelStats:
        if self.model_path.exists():
            raw = json.loads(self.model_path.read_text(encoding="utf-8"))
            return ModelStats(
                sample_count=int(raw.get("sample_count", 0)),
                class_count=int(raw.get("class_count", 0)),
                size_mean=float(raw.get("size_mean", 0.0)),
                weight_mean=float(raw.get("weight_mean", 0.0)),
                size_std=float(raw.get("size_std", 1.0)) or 1.0,
                weight_std=float(raw.get("weight_std", 1.0)) or 1.0,
                classes=list(raw.get("classes", [])),
            )
        return self.train(samples)

    def predict(self, samples: list[Sample], size: float, weight: float) -> list[dict[str, object]]:
        if not samples:
            return []

        stats = self.stats(samples)
        target = self._normalize(size, weight, stats)
        neighbors = []
        k = min(max(7, int(math.sqrt(len(samples))) + 2), len(samples))

        for sample in samples:
            point = self._normalize(sample.size, sample.weight, stats)
            distance = math.dist(target, point)
            weight_score = 1.0 / ((distance * distance) + 0.000001)
            neighbors.append((distance, weight_score, sample.creature))

        neighbors.sort(key=lambda item: item[0])
        votes: dict[str, float] = defaultdict(float)
        for _, weight_score, creature in neighbors[:k]:
            votes[creature] += weight_score

        total = sum(votes.values())
        if total <= 0:
            return []

        results = []
        for creature, score in votes.items():
            probability = score / total
            if probability > 0.01:
                results.append(
                    {
                        "creature": creature,
                        "probability": probability,
                        "percent": f"{probability * 100:.2f}%",
                    }
                )
        results.sort(key=lambda item: item["probability"], reverse=True)
        return results

    def summary(self, samples: list[Sample]) -> dict[str, object]:
        stats = self.stats(samples)
        counts = Counter(sample.creature for sample in samples)
        return {
            **asdict(stats),
            "class_distribution": dict(sorted(counts.items())),
        }

    def _save_stats(self, stats: ModelStats) -> None:
        self.model_path.write_text(
            json.dumps(asdict(stats), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _std(values: list[float], mean: float) -> float:
        if len(values) < 2:
            return 1.0
        variance = sum((value - mean) ** 2 for value in values) / len(values)
        return math.sqrt(variance) or 1.0

    @staticmethod
    def _normalize(size: float, weight: float, stats: ModelStats) -> tuple[float, float]:
        return (
            (size - stats.size_mean) / stats.size_std,
            (weight - stats.weight_mean) / stats.weight_std,
        )
