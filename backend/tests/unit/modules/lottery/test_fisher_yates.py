"""Fisher-Yates RNG 確定性 + 均勻性 + 邊界 + 效能(設計 06 §9.6 + FR-LOT-09)"""

import secrets
import time
from collections import Counter

import pytest

from app.modules.lottery.service import _fisher_yates_shuffle


def test_same_seed_same_output() -> None:
    """FR-LOT-09:相同 seed 兩次必產生相同結果"""
    items = [f"01HU{i:022d}" for i in range(50)]
    seed = "deadbeef" * 8
    a = _fisher_yates_shuffle(items, seed)
    b = _fisher_yates_shuffle(items, seed)
    assert a == b
    # 也跟原序列不同(極大機率)— 非 trivial shuffle
    assert a != items


def test_different_seed_different_output() -> None:
    items = [f"01HU{i:022d}" for i in range(20)]
    a = _fisher_yates_shuffle(items, "a" * 64)
    b = _fisher_yates_shuffle(items, "b" * 64)
    assert a != b


def test_empty_input() -> None:
    assert _fisher_yates_shuffle([], "seed-x") == []


def test_single_element() -> None:
    assert _fisher_yates_shuffle(["only"], "seed-x") == ["only"]


def test_two_elements() -> None:
    """兩元素只會產生兩種 permutation"""
    out = _fisher_yates_shuffle(["a", "b"], "seed-x")
    assert sorted(out) == ["a", "b"]


def test_preserves_all_elements() -> None:
    items = [f"id-{i}" for i in range(100)]
    out = _fisher_yates_shuffle(items, secrets.token_hex(32))
    assert sorted(out) == sorted(items)
    assert len(out) == 100


@pytest.mark.slow
def test_chi_square_uniformity() -> None:
    """卡方檢定 1000 次抽 5 取 1,均勻性 p > 0.05(設計 §9.6 + plan §7)"""
    from scipy.stats import chisquare # type: ignore[import-untyped]

    n_items = 5
    n_trials = 1000
    counts: Counter[int] = Counter()
    for _ in range(n_trials):
        seed = secrets.token_hex(32)
        out = _fisher_yates_shuffle([f"id-{i}" for i in range(n_items)], seed)
        # 看 id-0 落在哪個 index
        counts[out.index("id-0")] += 1
    observed = [counts[i] for i in range(n_items)]
    expected = [n_trials / n_items] * n_items
    _stat, p_value = chisquare(observed, expected)
    assert p_value > 0.05, f"chi-square p={p_value:.4f},分佈不均勻;observed={observed}"


@pytest.mark.slow
def test_performance_10k_to_100() -> None:
    """1 萬人抽完整 shuffle < 5 秒(NFR §7 30 秒寬鬆,我們抓 5 秒)"""
    items = [f"01HU{i:022d}" for i in range(10_000)]
    seed = secrets.token_hex(32)
    start = time.monotonic()
    out = _fisher_yates_shuffle(items, seed)
    elapsed = time.monotonic() - start
    assert len(out) == 10_000
    assert elapsed < 5.0, f"shuffle 10k 用了 {elapsed:.2f}s,超過 5 秒"
