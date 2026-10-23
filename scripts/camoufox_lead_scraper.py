#!/usr/bin/env python3
"""
Camoufox + Playwright B2B Local Lead Scraper
Designed for AI_Workspace | Anti-Detect Google Maps Lead Extractor
Flags businesses without websites (or using social-only links) as Priority 1 leads.
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import random
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Set
from urllib.parse import quote_plus

import httpx
from camoufox.async_api import AsyncCamoufox
from dotenv import load_dotenv
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

# Load environment variables from root .env
load_dotenv()

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("CamoufoxScraper")

# Domains that count as "No Real Website" (prime agency targets)
SOCIAL_ONLY_DOMAINS = (
    "facebook.com",
    "instagram.com",
    "yelp.com",
    "angi.com",
    "thumbtack.com",
    "nextdoor.com",
    "linktr.ee",
)


@dataclass
class BusinessLead:
    business_name: str
    niche_query: str
    lead_tier: str  # "TIER_1_NO_WEBSITE", "TIER_2_SOCIAL_ONLY", "TIER_3_HAS_WEBSITE"
    phone: str
    website: str
    rating: float
    review_count: int
    address: str
    maps_url: str
    scraped_at: str


def classify_website(url: str) -> str:
    """Categorizes a lead based on whether they own a standalone domain."""
    if not url:
        return "TIER_1_NO_WEBSITE"
    lowered = url.lower()
    if any(domain in lowered for domain in SOCIAL_ONLY_DOMAINS):
        return "TIER_2_SOCIAL_ONLY"
    return "TIER_3_HAS_WEBSITE"


async def human_delay(min_sec: float = 1.2, max_sec: float = 3.2) -> None:
    """Adds randomized jitter between actions to prevent behavioral rate-limiting."""
    await asyncio.sleep(random.uniform(min_sec, max_sec))


async def scroll_results_feed(page: Page, max_leads: int) -> List[str]:
    """Scrolls the Google Maps sidebar feed until max_leads links are collected."""
    feed_selector = 'div[role="feed"]'
    try:
        await page.wait_for_selector(feed_selector, timeout=15000)
    except PlaywrightTimeoutError:
        logger.warning("Results feed container not found. Checking for single result or block.")
        return []

    collected_urls: Set[str] = set()
    stagnant_scrolls = 0

    while len(collected_urls) < max_leads and stagnant_scrolls < 5:
        links = await page.locator('div[role="feed"] a[href*="/maps/place/"]').evaluate_all(
            "elements => elements.map(el => el.href)"
        )
        previous_count = len(collected_urls)
        for link in links:
            collected_urls.add(link)
            if len(collected_urls) >= max_leads:
                break

        if len(collected_urls) == previous_count:
            stagnant_scrolls += 1
        else:
            stagnant_scrolls = 0

        logger.info(f"Discovered {len(collected_urls)}/{max_leads} listing URLs...")

        # Hover and scroll inside the feed container
        feed_box = page.locator(feed_selector)
        await feed_box.evaluate("el => el.scrollBy(0, 900)")
        await human_delay(1.5, 2.8)

    return list(collected_urls)[:max_leads]


async def extract_listing_details(page: Page, url: str, query: str) -> Optional[BusinessLead]:
    """Visits an individual place URL and extracts structured contact & website metadata."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await human_delay(1.5, 3.0)

        # 1. Business Name
        name_loc = page.locator("h1").first
        business_name = (await name_loc.inner_text(timeout=8000)).strip() if await name_loc.count() else ""
        if not business_name:
            return None

        # 2. Website URL
        website = ""
        web_loc = page.locator('a[data-item-id="authority"]').first
        if await web_loc.count() > 0:
            website = (await web_loc.get_attribute("href")) or ""

        # 3. Phone Number
        phone = ""
        phone_loc = page.locator('button[data-item-id*="phone:tel:"]').first
        if await phone_loc.count() > 0:
            raw_phone = (await phone_loc.get_attribute("data-item-id")) or ""
            phone = raw_phone.replace("phone:tel:", "").strip()

        # 4. Address
        address = ""
        addr_loc = page.locator('button[data-item-id="address"]').first
        if await addr_loc.count() > 0:
            address = (await addr_loc.inner_text()).strip()

        # 5. Rating & Review Count
        rating = 0.0
        review_count = 0
        rating_loc = page.locator('div.F7nice span[aria-hidden="true"]').first
        if await rating_loc.count() > 0:
            try:
                rating = float((await rating_loc.inner_text()).strip().replace(",", "."))
            except ValueError:
                rating = 0.0

        reviews_loc = page.locator('div.F7nice span[aria-label*="review"]').first
        if await reviews_loc.count() > 0:
            raw_reviews = (await reviews_loc.get_attribute("aria-label")) or ""
            digits = re.sub(r"[^\d]", "", raw_reviews)
            if digits:
                review_count = int(digits)

        lead_tier = classify_website(website)

        return BusinessLead(
            business_name=business_name,
            niche_query=query,
            lead_tier=lead_tier,
            phone=phone,
            website=website,
            rating=rating,
            review_count=review_count,
            address=address,
            maps_url=url,
            scraped_at=datetime.utcnow().isoformat() + "Z",
        )

    except Exception as exc:
        logger.error(f"Failed to extract listing {url[:60]}...: {exc}")
        return None


async def push_to_n8n_webhook(leads: List[BusinessLead], webhook_url: str) -> None:
    """Sends scraped leads to your local or cloud n8n webhook router."""
    if not webhook_url or not leads:
        return

    payload = {
        "source": "camoufox_local_scraper",
        "total_leads": len(leads),
        "tier_1_count": sum(1 for l in leads if l.lead_tier == "TIER_1_NO_WEBSITE"),
        "leads": [asdict(l) for l in leads],
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, json=payload)
            resp.raise_for_status()
            logger.info(f"Pushed {len(leads)} leads to n8n webhook ({resp.status_code}).")
    except Exception as exc:
        logger.warning(f"Webhook delivery failed: {exc}")


def save_results(leads: List[BusinessLead], output_dir: Path, query: str) -> None:
    """Saves deduplicated leads to both CSV and JSON inside ./projects/leads/."""
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "_", query.lower()).strip("_")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    csv_path = output_dir / f"leads_{slug}_{timestamp}.csv"
    json_path = output_dir / f"leads_{slug}_{timestamp}.json"

    records = [asdict(lead) for lead in leads]

    if records:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=records[0].keys())
            writer.writeheader()
            writer.writerows(records)

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2, ensure_ascii=False)

        logger.info(f"Saved {len(records)} leads to:\n  -> {csv_path}\n  -> {json_path}")


async def run_scraper(
    query: str,
    max_leads: int,
    headless: bool,
    only_websiteless: bool,
    proxy_server: Optional[str] = None,
) -> None:
    proxy_config = {"server": proxy_server} if proxy_server else None

    logger.info(f"Launching Camoufox anti-detect browser | Query: '{query}' | Max: {max_leads}")

    # AsyncCamoufox automatically spoofs OS, WebGL, fonts, canvas, and humanizes cursor paths
    async with AsyncCamoufox(
        headless=headless,
        humanize=True,
        geoip=bool(proxy_server),
        proxy=proxy_config,
    ) as browser:
        page = await browser.new_page()

        search_url = f"https://www.google.com/maps/search/{quote_plus(query)}"
        logger.info(f"Navigating to {search_url}")
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        await human_delay(2.0, 4.0)

        # Handle Google consent modal if triggered by proxy region
        consent_btn = page.locator('button[aria-label*="Accept all"], form button:has-text("Accept all")').first
        if await consent_btn.count() > 0:
            await consent_btn.click()
            await human_delay(1.5, 2.5)

        place_urls = await scroll_results_feed(page, max_leads=max_leads)
        logger.info(f"Extracting details from {len(place_urls)} listings...")

        leads: List[BusinessLead] = []
        seen_keys: Set[str] = set()

        for idx, url in enumerate(place_urls, start=1):
            lead = await extract_listing_details(page, url, query)
            if not lead:
                continue

            # Deduplicate by name + phone
            dedupe_key = f"{lead.business_name.lower()}::{lead.phone}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            if only_websiteless and lead.lead_tier == "TIER_3_HAS_WEBSITE":
                logger.info(f"[{idx}/{len(place_urls)}] Skipping '{lead.business_name}' (has website: {lead.website[:35]})")
                continue

            leads.append(lead)
            logger.info(
                f"[{idx}/{len(place_urls)}] + {lead.business_name} | "
                f"{lead.lead_tier} | Phone: {lead.phone or 'N/A'} | Rating: {lead.rating} ({lead.review_count})"
            )

        # Sort so Tier 1 (No Website) leads appear at the top of your CSV
        leads.sort(key=lambda x: x.lead_tier)

        output_dir = Path("./projects/leads")
        save_results(leads, output_dir, query)

        webhook_url = os.getenv("N8N_LEAD_WEBHOOK_URL", "")
        if webhook_url:
            await push_to_n8n_webhook(leads, webhook_url)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Camoufox Anti-Detect B2B Lead Scraper")
    parser.add_argument(
        "-q",
        "--query",
        type=str,
        required=True,
        help='Search query (e.g., "HVAC contractors in Mooresville NC")',
    )
    parser.add_argument(
        "-m",
        "--max-leads",
        type=int,
        default=25,
        help="Maximum number of listings to inspect (default: 25)",
    )
    parser.add_argument(
        "--only-websiteless",
        action="store_true",
        help="Only save businesses with NO website or social-only links (Facebook/Yelp)",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run with a visible browser window for debugging (default is headless)",
    )
    parser.add_argument(
        "--proxy",
        type=str,
        default=os.getenv("CAMOUFOX_PROXY", ""),
        help="Optional HTTP/SOCKS5 proxy URL (e.g., http://user:pass@host:port)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(
        run_scraper(
            query=args.query,
            max_leads=args.max_leads,
            headless=not args.headed,
            only_websiteless=args.only_websiteless,
            proxy_server=args.proxy or None,
        )
    )
