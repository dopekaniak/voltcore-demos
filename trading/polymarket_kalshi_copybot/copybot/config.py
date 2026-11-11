"""Settings loaded from .env (bot folder first, then the repo root). No secrets live in code."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BOT_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BOT_DIR.parent.parent

KALSHI_BASE_URLS = {
    "prod": "https://external-api.kalshi.com/trade-api/v2",
    "demo": "https://external-api.demo.kalshi.co/trade-api/v2",
}
LIVE_CONFIRM_PHRASE = "I_ACCEPT_REAL_MONEY_RISK"


def load_env() -> None:
    load_dotenv(BOT_DIR / ".env", override=False)
    load_dotenv(REPO_ROOT / ".env", override=False)


def _s(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _f(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else float(default)


def _i(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(float(raw)) if raw else int(default)


def _b(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _list(name: str, default: str = "") -> list:
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass
class Settings:
    # mode
    mode: str = "paper"
    live_confirm: str = ""
    kalshi_env: str = "prod"
    kalshi_base_url: str = KALSHI_BASE_URLS["prod"]
    kalshi_key_id: str = ""
    kalshi_private_key_path: str = ""

    # leaders
    leader_top_n: int = 20
    leader_time_period: str = "month"
    leader_category: str = "overall"
    leader_min_pnl: float = 10_000
    leader_min_volume: float = 0
    leader_refresh_min: int = 60
    leader_wallets_extra: list = field(default_factory=list)
    leader_wallets_exclude: list = field(default_factory=list)

    # trade filters
    poll_interval_sec: int = 30
    min_leader_trade_usd: float = 500
    max_trade_age_sec: int = 600
    min_entry_price: float = 0.05
    max_entry_price: float = 0.95
    min_minutes_to_close: float = 30
    skip_slug_patterns: list = field(default_factory=list)
    copy_sells: bool = True

    # matching
    match_auto_threshold: float = 0.80
    match_review_threshold: float = 0.65
    match_max_date_diff_days: float = 0.5
    kalshi_universe_refresh_min: int = 60
    llm_verify_mode: str = "off"  # off | review | all
    llm_base_url: str = "http://localhost:20128/v1"
    llm_api_key: str = ""
    llm_model: str = "auto"
    llm_min_confidence: float = 0.8

    # sizing & risk
    copy_sizing: str = "fixed"  # fixed | proportional
    copy_usd_per_trade: float = 10
    copy_ratio: float = 0.001
    min_order_usd: float = 1
    max_order_usd: float = 25
    max_risk_pct_per_trade: float = 1
    max_price_gap: float = 0.03
    max_position_usd_per_market: float = 50
    max_total_exposure_usd: float = 250
    max_daily_spend_usd: float = 100
    daily_loss_limit_pct: float = 3
    max_orders_per_hour: int = 20
    max_open_positions: int = 15
    exit_slippage: float = 0.05
    paper_starting_balance: float = 1000

    # ops
    data_dir: Path = BOT_DIR / "data"
    aliases_path: Path = BOT_DIR / "aliases.json"
    market_map_path: Path = BOT_DIR / "market_map.json"
    healthcheck_url: str = ""
    log_level: str = "INFO"

    @property
    def is_live(self) -> bool:
        return self.mode == "live"

    @property
    def stop_file(self) -> Path:
        return self.data_dir / "STOP"

    @classmethod
    def from_env(cls) -> "Settings":
        load_env()
        env = _s("KALSHI_ENV", "prod").lower()
        s = cls(
            mode=_s("MODE", "paper").lower(),
            live_confirm=_s("LIVE_TRADING_CONFIRM"),
            kalshi_env=env,
            kalshi_base_url=_s("KALSHI_BASE_URL") or KALSHI_BASE_URLS.get(env, KALSHI_BASE_URLS["prod"]),
            kalshi_key_id=_s("KALSHI_API_KEY_ID"),
            kalshi_private_key_path=_s("KALSHI_PRIVATE_KEY_PATH"),
            leader_top_n=_i("LEADER_TOP_N", 20),
            leader_time_period=_s("LEADER_TIME_PERIOD", "month").lower(),
            leader_category=_s("LEADER_CATEGORY", "overall").lower(),
            leader_min_pnl=_f("LEADER_MIN_PNL", 10_000),
            leader_min_volume=_f("LEADER_MIN_VOLUME", 0),
            leader_refresh_min=_i("LEADER_REFRESH_MIN", 60),
            leader_wallets_extra=[w.lower() for w in _list("LEADER_WALLETS_EXTRA")],
            leader_wallets_exclude=[w.lower() for w in _list("LEADER_WALLETS_EXCLUDE")],
            poll_interval_sec=_i("POLL_INTERVAL_SEC", 30),
            min_leader_trade_usd=_f("MIN_LEADER_TRADE_USD", 500),
            max_trade_age_sec=_i("MAX_TRADE_AGE_SEC", 600),
            min_entry_price=_f("MIN_ENTRY_PRICE", 0.05),
            max_entry_price=_f("MAX_ENTRY_PRICE", 0.95),
            min_minutes_to_close=_f("MIN_MINUTES_TO_CLOSE", 30),
            skip_slug_patterns=[p.lower() for p in _list("SKIP_SLUG_PATTERNS", "updown,up-or-down,-5m-,-15m-")],
            copy_sells=_b("COPY_SELLS", True),
            match_auto_threshold=_f("MATCH_AUTO_THRESHOLD", 0.80),
            match_review_threshold=_f("MATCH_REVIEW_THRESHOLD", 0.65),
            match_max_date_diff_days=_f("MATCH_MAX_DATE_DIFF_DAYS", 0.5),
            kalshi_universe_refresh_min=_i("KALSHI_UNIVERSE_REFRESH_MIN", 60),
            llm_verify_mode=_s("LLM_VERIFY_MODE", "off").lower(),
            llm_base_url=_s("OMNIROUTE_BASE_URL", "http://localhost:20128/v1").rstrip("/"),
            llm_api_key=_s("OMNIROUTE_API_KEY"),
            llm_model=_s("LLM_MODEL", "auto"),
            llm_min_confidence=_f("LLM_MIN_CONFIDENCE", 0.8),
            copy_sizing=_s("COPY_SIZING", "fixed").lower(),
            copy_usd_per_trade=_f("COPY_USD_PER_TRADE", 10),
            copy_ratio=_f("COPY_RATIO", 0.001),
            min_order_usd=_f("MIN_ORDER_USD", 1),
            max_order_usd=_f("MAX_ORDER_USD", 25),
            max_risk_pct_per_trade=_f("MAX_RISK_PCT_PER_TRADE", 1),
            max_price_gap=_f("MAX_PRICE_GAP", 0.03),
            max_position_usd_per_market=_f("MAX_POSITION_USD_PER_MARKET", 50),
            max_total_exposure_usd=_f("MAX_TOTAL_EXPOSURE_USD", 250),
            max_daily_spend_usd=_f("MAX_DAILY_SPEND_USD", 100),
            daily_loss_limit_pct=_f("DAILY_LOSS_LIMIT_PCT", 3),
            max_orders_per_hour=_i("MAX_ORDERS_PER_HOUR", 20),
            max_open_positions=_i("MAX_OPEN_POSITIONS", 15),
            exit_slippage=_f("EXIT_SLIPPAGE", 0.05),
            paper_starting_balance=_f("PAPER_STARTING_BALANCE", 1000),
            data_dir=Path(_s("COPYBOT_DATA_DIR") or (BOT_DIR / "data")),
            healthcheck_url=_s("HEALTHCHECK_URL"),
            log_level=_s("LOG_LEVEL", "INFO").upper(),
        )
        s.validate()
        return s

    def validate(self) -> None:
        errors = []
        if self.mode not in ("paper", "live"):
            errors.append("MODE must be 'paper' or 'live'")
        if self.kalshi_env not in KALSHI_BASE_URLS:
            errors.append("KALSHI_ENV must be 'prod' or 'demo'")
        if self.is_live:
            if self.live_confirm != LIVE_CONFIRM_PHRASE:
                errors.append(f"MODE=live also requires LIVE_TRADING_CONFIRM={LIVE_CONFIRM_PHRASE}")
            if not self.kalshi_key_id or not self.kalshi_private_key_path:
                errors.append("MODE=live requires KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH")
        if self.leader_time_period not in ("day", "week", "month", "all"):
            errors.append("LEADER_TIME_PERIOD must be day|week|month|all")
        if self.copy_sizing not in ("fixed", "proportional"):
            errors.append("COPY_SIZING must be fixed|proportional")
        if self.llm_verify_mode not in ("off", "review", "all"):
            errors.append("LLM_VERIFY_MODE must be off|review|all")
        if not 0 < self.min_entry_price < self.max_entry_price < 1:
            errors.append("need 0 < MIN_ENTRY_PRICE < MAX_ENTRY_PRICE < 1")
        if not 0 <= self.max_price_gap < 0.5:
            errors.append("MAX_PRICE_GAP must be between 0 and 0.5")
        if self.match_review_threshold > self.match_auto_threshold:
            errors.append("MATCH_REVIEW_THRESHOLD must be <= MATCH_AUTO_THRESHOLD")
        if self.min_order_usd > self.max_order_usd:
            errors.append("MIN_ORDER_USD must be <= MAX_ORDER_USD")
        if errors:
            raise ValueError("Invalid configuration:\n  - " + "\n  - ".join(errors))
