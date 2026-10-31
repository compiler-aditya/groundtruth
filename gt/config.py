"""API clients and shared settings for the GroundTruth Day 1 tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAI

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

META_BASE_URL = "https://api.meta.ai/v1"
BASETEN_BASE_URL = "https://inference.baseten.co/v1"

SPARK = "muse-spark-1.3"
WONDER = "muse-wonder-1.0"
SAM = "sam-3.1"

# Pay-as-you-go prices from dev.meta.ai/docs/pricing-rate-limits (Oct 2026).
PRICE = {
    "spark_in_per_m": 1.25,
    "spark_out_per_m": 4.25,
    "wonder_in_per_m": 4.00,
    "wonder_out_per_m": 20.00,
    "sam_per_image": 2.50 / 1000,
    "sam_per_frame": 0.20 / 1000,
}

load_dotenv(ROOT / ".env")

# Hackathon Baseten keys only work with this model ID; Baseten's public docs use "meta-models/muse-spark-open".
SPARK_OPEN = os.environ.get("SPARK_OPEN_MODEL", "meta-models/muse-spark-open-1026")


def _key(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(
            f"{name} is not set. Put it in groundtruth/.env (see .env.example) "
            "or export it in your shell, or run with --dry-run."
        )
    return value


def meta_client() -> OpenAI:
    return OpenAI(base_url=META_BASE_URL, api_key=_key("MODEL_API_KEY"), timeout=600)


def meta_async_client() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=META_BASE_URL, api_key=_key("MODEL_API_KEY"), timeout=600)


def baseten_client() -> OpenAI:
    return OpenAI(base_url=BASETEN_BASE_URL, api_key=_key("BASETEN_API_KEY"), timeout=900)


def out_dir(name: str) -> Path:
    path = OUT / name
    path.mkdir(parents=True, exist_ok=True)
    return path
