#!/usr/bin/env python3
"""Generate assets/weather.svg — today's weather card for the profile README.

Data source: Open-Meteo (no API key). Location: Seoul (37.5665, 126.9780).
Also bumps the ?v=YYYYMMDDHH cache-buster on the README image tag so a fresh
card is visible right after the workflow pushes.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

LATITUDE = 37.5665
LONGITUDE = 126.9780
LOCATION_LABEL = "서울"
TIMEZONE = ZoneInfo("Asia/Seoul")

API_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LATITUDE}&longitude={LONGITUDE}"
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code"
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,is_day"
    "&timezone=Asia%2FSeoul&forecast_days=1"
)

ROOT = Path(__file__).resolve().parents[2]
SVG_PATH = ROOT / "assets" / "weather.svg"
README_PATH = ROOT / "README.md"

# WMO weather code -> (day emoji, night emoji, korean label)
WEATHER_CODES = {
    0: ("☀️", "🌙", "맑음"),
    1: ("🌤️", "🌙", "대체로 맑음"),
    2: ("⛅", "☁️", "구름 조금"),
    3: ("☁️", "☁️", "흐림"),
    45: ("🌫️", "🌫️", "안개"),
    48: ("🌫️", "🌫️", "짙은 안개"),
    51: ("🌦️", "🌦️", "약한 이슬비"),
    53: ("🌦️", "🌦️", "이슬비"),
    55: ("🌧️", "🌧️", "강한 이슬비"),
    56: ("🌧️", "🌧️", "어는 이슬비"),
    57: ("🌧️", "🌧️", "강한 어는 이슬비"),
    61: ("🌦️", "🌧️", "약한 비"),
    63: ("🌧️", "🌧️", "비"),
    65: ("🌧️", "🌧️", "강한 비"),
    66: ("🌧️", "🌧️", "어는 비"),
    67: ("🌧️", "🌧️", "강한 어는 비"),
    71: ("🌨️", "🌨️", "약한 눈"),
    73: ("🌨️", "🌨️", "눈"),
    75: ("❄️", "❄️", "강한 눈"),
    77: ("🌨️", "🌨️", "눈 알갱이"),
    80: ("🌦️", "🌧️", "약한 소나기"),
    81: ("🌦️", "🌧️", "소나기"),
    82: ("⛈️", "⛈️", "강한 소나기"),
    85: ("🌨️", "🌨️", "눈 소나기"),
    86: ("❄️", "❄️", "강한 눈 소나기"),
    95: ("⛈️", "⛈️", "천둥번개"),
    96: ("⛈️", "⛈️", "우박 동반 천둥번개"),
    99: ("⛈️", "⛈️", "강한 우박 동반 천둥번개"),
}

WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


def fetch_weather() -> dict:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            request = urllib.request.Request(
                API_URL, headers={"User-Agent": "xoxoworld-weather-card"}
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:  # network hiccup, 5xx, truncated body
            last_error = error
            print(f"Open-Meteo attempt {attempt + 1} failed: {error}", file=sys.stderr)
            time.sleep(1)

    # Fallback to local weather command if available
    try:
        import subprocess
        res = subprocess.run(
            ["weather", f"{LATITUDE}, {LONGITUDE}"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        data = json.loads(res.stdout)["data"]
        now_data = data.get("now", {})
        today_data = data.get("days", [{}])[0]

        cond = (now_data.get("condition") or today_data.get("condition") or "").lower()
        if "clear" in cond:
            code = 0 if "mostly" not in cond else 1
        elif "partly" in cond:
            code = 2
        elif "cloud" in cond:
            code = 3
        elif "fog" in cond or "mist" in cond:
            code = 45
        elif "drizzle" in cond:
            code = 53
        elif "rain" in cond or "shower" in cond:
            code = 63
        elif "snow" in cond:
            code = 73
        elif "thunder" in cond or "storm" in cond:
            code = 95
        else:
            code = 3

        wind_kmh = now_data.get("wind_kmh", 0)
        wind_ms = round(wind_kmh / 3.6, 1)

        return {
            "daily": {
                "weather_code": [code],
                "temperature_2m_max": [today_data.get("high_c", 15)],
                "temperature_2m_min": [today_data.get("low_c", 5)],
                "precipitation_probability_max": [today_data.get("precipitation_chance", 0)],
            },
            "current": {
                "temperature_2m": now_data.get("temperature_c", 10),
                "apparent_temperature": now_data.get("feels_like_c", 10),
                "relative_humidity_2m": now_data.get("humidity", 50),
                "wind_speed_10m": wind_ms,
                "is_day": 1 if 7 <= datetime.now(TIMEZONE).hour < 18 else 0,
            },
        }
    except Exception as fallback_error:
        print(f"Fallback to weather CLI failed: {fallback_error}", file=sys.stderr)

    raise SystemExit(f"could not fetch weather data: {last_error}")


def fmt_temp(value: float) -> str:
    return f"{round(value):d}°"


def build_svg(payload: dict, now: datetime) -> str:
    daily = payload["daily"]
    current = payload.get("current", {})

    code = int(daily["weather_code"][0])
    is_day = int(current.get("is_day", 1))
    day_emoji, night_emoji, label = WEATHER_CODES.get(code, ("🌡️", "🌡️", "알 수 없음"))
    emoji = day_emoji if is_day else night_emoji

    t_max = fmt_temp(daily["temperature_2m_max"][0])
    t_min = fmt_temp(daily["temperature_2m_min"][0])
    pop = daily["precipitation_probability_max"][0]
    pop_text = "--" if pop is None else f"{round(pop):d}%"

    now_temp = current.get("temperature_2m")
    now_text = f"{round(now_temp):d}°" if now_temp is not None else "--"

    feels = current.get("apparent_temperature")
    feels_text = f"{round(feels):d}°" if feels is not None else "--"
    humidity = current.get("relative_humidity_2m")
    humidity_text = f"{round(humidity):d}%" if humidity is not None else "--"
    wind = current.get("wind_speed_10m")
    wind_text = f"{wind:.1f} m/s" if wind is not None else "--"

    day_text = f"{now.year}. {now.month:02d}. {now.day:02d}. ({WEEKDAYS[now.weekday()]})"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="840" height="232" viewBox="0 0 840 232" role="img" aria-label="오늘의 날씨 {LOCATION_LABEL}: {label}, 최고 {t_max} 최저 {t_min}">
  <title>오늘의 날씨 — {LOCATION_LABEL}</title>
  <desc>{now.year}년 {now.month}월 {now.day}일 {LOCATION_LABEL} 날씨: {label}, 최고 {t_max} / 최저 {t_min}, 강수확률 {pop_text}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1b26"/>
      <stop offset="55%" stop-color="#1f2335"/>
      <stop offset="100%" stop-color="#24283b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#bb9af7"/>
      <stop offset="50%" stop-color="#7dcfff"/>
      <stop offset="100%" stop-color="#2dd4bf"/>
    </linearGradient>
    <linearGradient id="pill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#bb9af7" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#2dd4bf" stop-opacity="0.16"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#7aa2f7" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#7aa2f7" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <style>
    .ui {{ font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Segoe UI', system-ui, -apple-system, sans-serif; }}
    .muted {{ fill: #565f89; }}
    .body {{ fill: #c0caf5; }}
    .dim {{ fill: #a9b1d6; }}
  </style>

  <rect x="1" y="1" width="838" height="230" rx="20" fill="url(#bg)" stroke="#2dd4bf" stroke-opacity="0.28" stroke-width="1.5"/>
  <rect x="1" y="1" width="838" height="4" rx="2" fill="url(#accent)" opacity="0.85"/>

  <!-- location + date -->
  <rect x="32" y="26" width="104" height="34" rx="17" fill="url(#pill)" stroke="#bb9af7" stroke-opacity="0.45"/>
  <text class="ui" x="48" y="48" font-size="15" font-weight="700" fill="#bb9af7">📍 {LOCATION_LABEL}</text>
  <text class="ui" x="808" y="42" font-size="14" text-anchor="end" fill="#a9b1d6">{day_text}</text>
  <text class="ui" x="808" y="60" font-size="12" text-anchor="end" fill="#565f89">오늘의 날씨 · Today</text>

  <!-- current -->
  <circle cx="96" cy="128" r="62" fill="url(#glow)"/>
  <text class="ui" x="132" y="102" font-size="13" letter-spacing="1" fill="#565f89">지금</text>
  <text x="40" y="160" font-size="66">{emoji}</text>
  <text class="ui" x="132" y="164" font-size="56" font-weight="800" fill="#ffffff">{now_text}</text>
  <text class="ui" x="252" y="150" font-size="22" font-weight="600" fill="#c0caf5">{label}</text>
  <text class="ui" x="252" y="176" font-size="13" fill="#7aa2f7">체감 {feels_text} · 습도 {humidity_text} · 바람 {wind_text}</text>

  <!-- stats -->
  <line x1="466" y1="86" x2="466" y2="176" stroke="#2ac3de" stroke-opacity="0.18"/>
  <text class="ui" x="500" y="104" font-size="12" fill="#565f89">최고</text>
  <text class="ui" x="500" y="140" font-size="28" font-weight="700" fill="#ff9e64">{t_max}</text>
  <text class="ui" x="620" y="104" font-size="12" fill="#565f89">최저</text>
  <text class="ui" x="620" y="140" font-size="28" font-weight="700" fill="#7aa2f7">{t_min}</text>
  <text class="ui" x="720" y="104" font-size="12" fill="#565f89">강수확률</text>
  <text class="ui" x="720" y="140" font-size="28" font-weight="700" fill="#7dcfff">{pop_text}</text>

  <!-- footer -->
  <line x1="32" y1="192" x2="808" y2="192" stroke="#2ac3de" stroke-opacity="0.15"/>
  <text class="ui" x="32" y="214" font-size="12" fill="#565f89">서울특별시 기준 · Open-Meteo</text>
  <text class="ui" x="808" y="214" font-size="12" text-anchor="end" fill="#565f89">매일 09:00 · 18:00 (KST) 자동 갱신</text>
</svg>
"""


def bump_readme_cache_buster(version: str) -> None:
    if not README_PATH.exists():
        print("README.md not found; skipping cache-buster update", file=sys.stderr)
        return
    readme = README_PATH.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"(assets/weather\.svg\?v=)\d{10}", rf"\g<1>{version}", readme
    )
    if count == 0:
        print("no weather image tag with cache-buster found in README.md", file=sys.stderr)
        return
    README_PATH.write_text(updated, encoding="utf-8")
    print(f"README cache-buster updated to v={version} ({count} tag)")

def main() -> None:
    now = datetime.now(TIMEZONE)
    payload = fetch_weather()
    svg = build_svg(payload, now)

    SVG_PATH.parent.mkdir(parents=True, exist_ok=True)
    SVG_PATH.write_text(svg, encoding="utf-8")
    print(f"wrote {SVG_PATH.relative_to(ROOT)} for {now.isoformat()}")

    bump_readme_cache_buster(now.strftime("%Y%m%d%H"))


if __name__ == "__main__":
    main()
