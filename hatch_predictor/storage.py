from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Sample:
    id: str
    size: float
    weight: float
    creature: str


class DatasetStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> list[Sample]:
        if not self.path.exists():
            return []
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        return [
            Sample(
                id=str(item["id"]),
                size=float(item["size"]),
                weight=float(item["weight"]),
                creature=str(item["creature"]).strip(),
            )
            for item in raw
        ]

    def save(self, samples: Iterable[Sample]) -> None:
        payload = [asdict(sample) for sample in samples]
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def add(self, size: float, weight: float, creature: str) -> tuple[bool, Sample, list[Sample]]:
        creature = creature.strip()
        samples = self.load()
        for sample in samples:
            if sample.size == size and sample.weight == weight and sample.creature == creature:
                return False, sample, samples

        sample = Sample(id=str(uuid.uuid4()), size=size, weight=weight, creature=creature)
        samples.append(sample)
        self.save(samples)
        return True, sample, samples

    def delete(self, sample_id: str) -> tuple[bool, list[Sample]]:
        samples = self.load()
        remaining = [sample for sample in samples if sample.id != sample_id]
        if len(remaining) == len(samples):
            return False, samples
        self.save(remaining)
        return True, remaining
