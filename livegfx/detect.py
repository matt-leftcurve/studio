"""Live graphics: turn a transcript utterance into graphic intents.

Pure, rule-based and deterministic (no model, no network) so it runs in well under a
millisecond and can never invent numbers: an intent only names WHAT to chart; every value
on a card comes from market.py. Handles the caption bridge's bilingual output (Chinese line +
English line), so both are scanned.

Intent kinds:
  compare  2+ assets, normalized % performance over a window ("BTC vs gold since the halving")
  level    1 asset + a price level ("ETH broke 3,000")
  price    1 asset + a window or a movement cue ("SOL this month", "bitcoin dumped")
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------- assets
# key -> (display, kind, provider symbol, aliases). kind: crypto (Binance/Coinbase) | yahoo
ASSETS: dict[str, dict] = {}


def _a(key, name, kind, sym, aliases, zh=()):
    ASSETS[key] = {"key": key, "name": name, "kind": kind, "sym": sym,
                   "aliases": list(aliases), "zh": list(zh)}


_a("BTC", "Bitcoin", "crypto", "BTC", ["bitcoin", "btc", "xbt", "bitcoins"], ["比特币", "大饼", "比特"])
_a("ETH", "Ethereum", "crypto", "ETH", ["ethereum", "eth", "ether"], ["以太坊", "以太", "二饼"])
_a("SOL", "Solana", "crypto", "SOL", ["solana", "sol"], ["索拉纳", "SOL"])
_a("XRP", "XRP", "crypto", "XRP", ["xrp", "ripple"], ["瑞波"])
_a("DOGE", "Dogecoin", "crypto", "DOGE", ["dogecoin", "doge"], ["狗狗币"])
_a("BNB", "BNB", "crypto", "BNB", ["bnb", "binance coin"], ["币安币"])
_a("LINK", "Chainlink", "crypto", "LINK", ["chainlink"], [])
_a("AVAX", "Avalanche", "crypto", "AVAX", ["avalanche", "avax"], [])
_a("SUI", "Sui", "crypto", "SUI", ["sui"], [])
_a("NEAR", "NEAR", "crypto", "NEAR", ["near protocol", "near"], [])  # on Bender's whisper prompt lineup
_a("ZEC", "Zcash", "crypto", "ZEC", ["zcash", "zec"], ["大零币"])
_a("GOLD", "Gold", "yahoo", "GC=F", ["gold", "xau", "xauusd"], ["黄金", "金价"])
_a("SILVER", "Silver", "yahoo", "SI=F", ["silver", "xag"], ["白银"])
_a("OIL", "Crude oil", "yahoo", "CL=F", ["crude", "oil", "wti"], ["原油", "油价"])
_a("SPX", "S&P 500", "yahoo", "^GSPC", ["s&p", "s and p", "s&p 500", "sp500", "spx", "spy", "the s p"], ["标普", "标普500"])
_a("NDX", "Nasdaq 100", "yahoo", "^NDX", ["nasdaq", "ndx", "qqq", "nas100"], ["纳指", "纳斯达克"])
_a("DJI", "Dow Jones", "yahoo", "^DJI", ["the dow", "dow jones", "djia"], ["道琼斯", "道指"])
_a("DXY", "US Dollar Index", "yahoo", "DX-Y.NYB", ["dxy", "dollar index", "the dollar"], ["美元指数"])
_a("US10Y", "US 10Y yield", "yahoo", "^TNX", ["10 year", "ten year", "10-year", "ten-year", "tens", "treasury yield", "bond yields"], ["十年期", "美债收益率", "10年期"])
_a("VIX", "VIX", "yahoo", "^VIX", ["vix", "volatility index"], ["恐慌指数"])
for _t, _n in [("NVDA", "Nvidia"), ("TSLA", "Tesla"), ("AAPL", "Apple"), ("MSFT", "Microsoft"),
               ("AMZN", "Amazon"), ("META", "Meta"), ("GOOGL", "Google"), ("MSTR", "Strategy (MSTR)"),
               ("COIN", "Coinbase"), ("HOOD", "Robinhood"), ("IBIT", "iShares Bitcoin ETF"),
               ("CRCL", "Circle"), ("PLTR", "Palantir"), ("AMD", "AMD")]:
    _a(_t, _n, "yahoo", _t, [_n.lower().split(" (")[0], _t.lower()], [])
ASSETS["NVDA"]["zh"] = ["英伟达"]; ASSETS["TSLA"]["zh"] = ["特斯拉"]; ASSETS["AAPL"]["zh"] = ["苹果"]
ASSETS["MSTR"]["aliases"] += ["microstrategy", "strategy stock", "saylor"]; ASSETS["MSTR"]["zh"] = ["微策略"]
ASSETS["COIN"]["aliases"] = ["coinbase", "coin stock"]  # bare "coin" is too common
ASSETS["META"]["aliases"] = ["meta", "facebook"]
ASSETS["AMZN"]["aliases"] += ["amzn"]
ASSETS["GOOGL"]["aliases"] += ["alphabet", "googl"]
ASSETS["HOOD"]["aliases"] = ["robinhood", "hood stock"]
ASSETS["SUI"]["aliases"] = ["sui"]
ASSETS["SOL"]["aliases"] = ["solana", "sol"]
ASSETS["PLTR"]["aliases"] = ["palantir", "pltr"]
ASSETS["AMD"]["aliases"] = ["amd"]

# words that collide with ordinary speech: only count them as tickers when cashtagged or uppercase
_AMBIGUOUS = {"sol", "link", "sui", "coin", "meta", "tens", "oil", "gold", "spy", "the dollar"}
_AMBIG_NEEDS_CTX = {"sol", "sui", "tens", "spy", "near"}  # need $TAG or UPPER in the original text

_alias_index: list[tuple[str, str]] = []
for _k, _v in ASSETS.items():
    for _al in _v["aliases"]:
        _alias_index.append((_al, _k))
_alias_index.sort(key=lambda p: -len(p[0]))  # longest first
_zh_index = sorted(((z, k) for k, v in ASSETS.items() for z in v["zh"]), key=lambda p: -len(p[0]))


def find_assets(text: str) -> list[tuple[int, str]]:
    """[(position, asset key)] in order of appearance, deduped (first mention wins)."""
    hits: list[tuple[int, str]] = []
    low = text.lower()
    taken = [False] * (len(low) + 1)
    for m in re.finditer(r"\$([A-Za-z]{2,6})\b", text):  # cashtags
        k = m.group(1).upper()
        if k in ASSETS:
            hits.append((m.start(), k))
            for i in range(m.start(), m.end()):
                taken[i] = True
    for al, k in _alias_index:
        for m in re.finditer(r"(?<![a-z0-9])" + re.escape(al) + r"(?![a-z0-9])", low):
            if any(taken[m.start():m.end()]):
                continue
            if al in _AMBIG_NEEDS_CTX:
                orig = text[m.start():m.end()]
                if not orig.isupper():
                    continue
            hits.append((m.start(), k))
            for i in range(m.start(), m.end()):
                taken[i] = True
    for z, k in _zh_index:
        for m in re.finditer(re.escape(z), text):
            if any(taken[m.start():m.end()]):
                continue
            hits.append((m.start(), k))
            for i in range(m.start(), m.end()):
                taken[i] = True
    hits.sort()
    seen, out = set(), []
    for pos, k in hits:
        if k not in seen:
            seen.add(k)
            out.append((pos, k))
    return out


# ---------------------------------------------------------------- numbers
_ZH_DIG = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_ZH_UNIT = {"十": 10, "百": 100, "千": 1000}


def zh_number(s: str) -> float | None:
    """Small Chinese numeral parser: 三千, 十万, 三千五百, 6万, 3.5万, 十二万."""
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([千万亿])", s)
    if m:
        return float(m.group(1)) * {"千": 1e3, "万": 1e4, "亿": 1e8}[m.group(2)]
    total, section, num = 0, 0, 0
    if not s or any(c not in _ZH_DIG and c not in _ZH_UNIT and c not in "万亿" for c in s):
        return None
    for c in s:
        if c in _ZH_DIG:
            num = _ZH_DIG[c]
        elif c in _ZH_UNIT:
            section += (num or 1) * _ZH_UNIT[c]
            num = 0
        elif c == "万":
            total += (section + num) * 10000
            section, num = 0, 0
        elif c == "亿":
            total += (section + num) * 100000000
            section, num = 0, 0
    total += section + num
    return float(total) if total else None


_NUM_RE = re.compile(
    r"\$?\s?(?P<n>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?P<suf>k\b|K\b|thousand\b|grand\b|million\b|mil\b|m\b|bucks\b|dollars\b)?",
)
_ZH_NUM_RE = re.compile(r"(\d+(?:\.\d+)?[千万]|[零一二两三四五六七八九十百千万]{2,})")


_EN_UNITS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
             "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
             "seventeen": 17, "eighteen": 18, "nineteen": 19, "a": 1}
_EN_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_EN_WORD = "|".join(list(_EN_TENS) + list(_EN_UNITS))
_EN_NUM_RE = re.compile(r"\b((?:(?:" + _EN_WORD + r")[\s-]*){1,3}(?:hundred[\s-]*(?:and[\s-]*)?(?:(?:" + _EN_WORD + r")[\s-]*){0,2})?)(thousand|million|hundred|k)\b")


def en_words_number(words: str, scale: str) -> float | None:
    total, cur = 0, 0
    for w in re.split(r"[\s-]+", words.strip()):
        if not w or w == "and":
            continue
        if w in _EN_UNITS:
            cur += _EN_UNITS[w]
        elif w in _EN_TENS:
            cur += _EN_TENS[w]
        elif w == "hundred":
            cur = (cur or 1) * 100
        else:
            return None
    total = cur or 1
    return float(total * {"thousand": 1e3, "k": 1e3, "million": 1e6, "hundred": 100}[scale])


def find_numbers(text: str) -> list[tuple[int, float]]:
    out = []
    for m in _EN_NUM_RE.finditer(text.lower()):
        v = en_words_number(m.group(1), m.group(2))
        if v:
            out.append((m.start(), v))
    for m in _NUM_RE.finditer(text):
        if re.match(r"\s*[千万亿]", text[m.end("n"):m.end("n") + 2]):
            continue  # "9万" is handled by the Chinese pass
        n = float(m.group("n").replace(",", ""))
        suf = (m.group("suf") or "").lower()
        if suf in ("k", "thousand", "grand"):
            n *= 1e3
        elif suf in ("million", "mil", "m"):
            n *= 1e6
        # bare years are not price levels
        if not suf and 1990 <= n <= 2035 and "," not in m.group("n") and "." not in m.group("n"):
            continue
        out.append((m.start(), n))
    for m in _ZH_NUM_RE.finditer(text):
        v = zh_number(m.group(1))
        if v:
            out.append((m.start(), v))
    return out


# ---------------------------------------------------------------- time windows
EVENTS = [  # (regex, iso date, label)
    (r"halving|减半", "2024-04-20", "since the halving"),
    (r"(the|us|trump'?s?) election|大选", "2024-11-05", "since the election"),
    (r"(the )?inauguration|就职", "2025-01-20", "since the inauguration"),
    (r"etf (approval|launch|approved)|the etfs? (launched|got approved)", "2024-01-11", "since the spot ETF launch"),
    (r"covid|疫情", "2020-03-12", "since the COVID crash"),
    (r"liberation day|tariff (crash|day)", "2025-04-02", "since Liberation Day"),
    (r"(the )?ftx", "2022-11-08", "since FTX"),
]
_MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                         "august", "september", "october", "november", "december"], 1)}
_WORDNUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
            "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fourteen": 14, "thirty": 30, "ninety": 90, "couple": 2, "few": 3}
_UNIT_DAYS = {"hour": 1 / 24, "day": 1, "week": 7, "month": 30.44, "quarter": 91.3, "year": 365.25}


@dataclass
class Window:
    start: _dt.datetime
    label: str
    days: float


def parse_window(en: str, zh: str = "", now: _dt.datetime | None = None) -> Window | None:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    low = en.lower()
    for rx, iso, label in EVENTS:
        if re.search(r"(since|after|from)\s+(the\s+)?[^.?!]{0,20}?(" + rx + ")", low) or re.search(rx, zh) and re.search(r"以来|之后|到现在|后", zh):
            st = _dt.datetime.fromisoformat(iso).replace(tzinfo=_dt.timezone.utc)
            return Window(st, label, (now - st).total_seconds() / 86400)
    if re.search(r"\b(ytd|year to date|this year)\b", low) or "今年" in zh:
        st = _dt.datetime(now.year, 1, 1, tzinfo=_dt.timezone.utc)
        return Window(st, "year to date", (now - st).total_seconds() / 86400)
    m = re.search(r"\b(?:last|past|over the last|over the past|in the last)\s+(\d+|[a-z]+)?\s*(hour|day|week|month|quarter|year)s?\b", low)
    if m:
        q = m.group(1)
        k = 1 if q in (None, "") else (int(q) if q.isdigit() else _WORDNUM.get(q))
        if k:
            d = k * _UNIT_DAYS[m.group(2)]
            unit = m.group(2) + ("s" if k != 1 else "")
            return Window(now - _dt.timedelta(days=d), f"last {k} {unit}" if k != 1 else f"last {m.group(2)}", d)
    m = re.search(r"\b(this|the) (week|month|quarter)\b", low)
    if m:
        d = _UNIT_DAYS[m.group(2)]
        return Window(now - _dt.timedelta(days=d), f"this {m.group(2)}", d)
    if re.search(r"\b(today|24 hours|overnight)\b", low) or re.search(r"今天|24小时", zh):
        return Window(now - _dt.timedelta(days=1), "last 24 hours", 1)
    m = re.search(r"\bsince\s+(" + "|".join(_MONTHS) + r")(?:\s+(20\d\d))?\b", low)
    if m:
        mon = _MONTHS[m.group(1)]
        yr = int(m.group(2)) if m.group(2) else (now.year if mon <= now.month else now.year - 1)
        st = _dt.datetime(yr, mon, 1, tzinfo=_dt.timezone.utc)
        return Window(st, f"since {m.group(1).title()} {yr}", (now - st).total_seconds() / 86400)
    m = re.search(r"\bsince\s+(20[0-3]\d)\b", low) or re.search(r"(20[0-3]\d)年(以来|到现在)", zh)
    if m:
        st = _dt.datetime(int(m.group(1)), 1, 1, tzinfo=_dt.timezone.utc)
        return Window(st, f"since {m.group(1)}", (now - st).total_seconds() / 86400)
    m = re.search(r"(过去|最近)?(一|两|三|半)?(周|个月|年)", zh)
    if m and (m.group(1) or "这" + m.group(3) in zh or "本" + m.group(3) in zh):
        mult = {"一": 1, "两": 2, "三": 3, "半": 0.5, None: 1}[m.group(2)]
        base = {"周": 7, "个月": 30.44, "年": 365.25}[m.group(3)]
        d = mult * base
        return Window(now - _dt.timedelta(days=d), {"周": "last week", "个月": "last month", "年": "last year"}[m.group(3)], d)
    return None


# ---------------------------------------------------------------- intents
_COMPARE_RE = re.compile(r"\b(vs\.?|versus|compared (to|with)|against|relative to|outperform\w*|underperform\w*|beat(ing|en)?|ratio)\b")
_COMPARE_ZH = re.compile(r"对比|相比|比较|跑赢|跑输|和.{1,6}比")
_LEVEL_RE = re.compile(
    r"\b(broke|breaks?|breaking|broken|blew through|above|below|over|under|reclaim\w*|lost|losing|hit|hits|hitting|tagged|touch\w*|test\w*|"
    r"support|resistance|at|to|toward|towards|target|breakout|breakdown|flip\w*|holding|held|retest\w*)\b")
_LEVEL_ZH = re.compile(r"突破|跌破|站上|站稳|失守|守住|支撑|阻力|压力|关口|回到|涨到|跌到|目标")
_MOVE_RE = re.compile(r"\b(chart|price|pump\w*|dump\w*|rall\w*|crash\w*|rip\w*|moon\w*|sell-?off|bleed\w*|squeez\w*|run(ning)? up|ripping|tank\w*)\b")
_MOVE_ZH = re.compile(r"暴涨|暴跌|大涨|大跌|拉盘|砸盘|走势|行情|价格|涨了|跌了")


@dataclass
class Intent:
    kind: str                      # compare | level | price
    assets: list[str]
    window: Window | None = None
    level: float | None = None
    direction: str | None = None   # above | below (for levels)
    quote: str = ""
    key: str = field(default="")

    def __post_init__(self):
        if not self.key:
            w = self.window.label if self.window else "-"
            lv = f"{self.level:g}" if self.level else "-"
            self.key = f"{self.kind}|{'+'.join(self.assets)}|{w}|{lv}"


def _direction(text: str) -> str | None:
    t = text.lower()
    if re.search(r"\b(broke|break|above|over|reclaim|breakout|flip|holding|held)", t) or re.search(r"突破|站上|站稳|守住", text):
        return "above"
    if re.search(r"\b(below|under|lost|losing|breakdown)\b", t) or re.search(r"跌破|失守", text):
        return "below"
    return None


def detect(en: str, zh: str = "", now: _dt.datetime | None = None) -> list[Intent]:
    """All intents in one utterance (en line + optional zh line), strongest first."""
    en = (en or "").replace("…", " ").strip()
    zh = (zh or "").replace("…", " ").strip()
    if not en and not zh:
        return []
    a_en = find_assets(en)
    a_zh = find_assets(zh)
    keys = [k for _, k in a_en] + [k for _, k in a_zh if k not in {k2 for _, k2 in a_en}]
    if not keys:
        return []
    win = parse_window(en, zh, now)
    quote = en or zh
    low = en.lower()
    intents: list[Intent] = []

    # comparisons: 2+ assets with a compare cue, or 2+ assets and an explicit window
    if len(keys) >= 2 and (_COMPARE_RE.search(low) or _COMPARE_ZH.search(zh) or win):
        intents.append(Intent("compare", keys[:4], win, quote=quote))

    # levels: a number next to a level verb, tied to the nearest preceding asset mention
    for text, assets in ((en, a_en), (zh, a_zh)):
        if not assets:
            continue
        for npos, val in sorted(find_numbers(text)):
            window_txt = text[max(0, npos - 40):npos + 25]
            if not (_LEVEL_RE.search(window_txt.lower()) or _LEVEL_ZH.search(window_txt)):
                continue
            prior = [k for p, k in assets if p <= npos] or [assets[0][1]]
            k = prior[-1]
            if any(i.kind == "level" and i.assets == [k] for i in intents):
                break
            # percent figures, timeframes and counts are not levels
            tail = text[npos:npos + 20].lower()
            if re.match(r"[\$\s]*[\d,\.]+\s*(%|percent|x\b|days?|weeks?|months?|years?|hours?|bps|basis)", tail) or re.match(r"[\d\.]+\s*[%倍天周月年]", text[npos:npos + 8]):
                continue
            intents.append(Intent("level", [k], parse_window(en, zh, now), level=val, direction=_direction(window_txt), quote=quote))
            break

    # single-asset price card: needs a window or a movement cue (bare mentions are too common)
    if not intents and (win or _MOVE_RE.search(low) or _MOVE_ZH.search(zh)):
        intents.append(Intent("price", keys[:1], win, quote=quote))

    seen, out = set(), []
    for it in intents:
        if it.key not in seen:
            seen.add(it.key)
            out.append(it)
    return out
