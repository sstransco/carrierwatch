"""
CarrierWatch — Surname origin classification pipeline.

Classifies unique surnames from carrier_principals into national origins
using a character n-gram Naive Bayes model trained on curated surname data.

25 specific categories (Japanese, Korean, Indian, etc.) with 10 regional
fallback groups (East Asian, South Asian, Latino, etc.) — every surname
gets a classification, no unknowns.

No external ML libraries required — pure Python + psycopg2.

Usage:
    cd pipeline && DATABASE_URL=postgresql://... python3 classify_surnames.py
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
from collections import Counter

import psycopg2
import psycopg2.extras

from config import DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

BATCH_SIZE = 10_000

# Confidence threshold: below this, fall back to region group
SPECIFIC_THRESHOLD = 0.35

# Suffixes to strip from end of names before extracting surname
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "md", "dds", "esq", "phd", "cpa"}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_training_data():
    """Load surname_origins.json with categories and fallback groups."""
    path = os.path.join(SCRIPT_DIR, "surname_origins.json")
    log.info("Loading training data from %s", path)
    with open(path, "r") as f:
        data = json.load(f)

    categories = data.get("categories", [])
    fallback_groups = data.get("fallback_groups", [])

    log.info("Loaded %d specific categories, %d fallback groups",
             len(categories), len(fallback_groups))
    return categories, fallback_groups


def extract_ngrams(name, n_range=(2, 3, 4)):
    """Extract character n-grams from a name with boundary markers."""
    padded = f"^{name}$"
    ngrams = []
    for n in n_range:
        for i in range(len(padded) - n + 1):
            ngrams.append(padded[i:i + n])
    return ngrams


class NaiveBayesClassifier:
    """Multinomial Naive Bayes using character n-grams."""

    def __init__(self, smoothing=0.5):
        self.smoothing = smoothing
        self.ngram_counts = {}    # {code: Counter}
        self.totals = {}          # {code: total_ngrams}
        self.priors = {}          # {code: log_prior}
        self.info = {}            # {code: {name, region}}
        self.vocab = set()

    def train(self, entries):
        """Train on list of dicts with 'code', 'name', 'surnames', and optionally 'region'."""
        total_surnames = sum(len(e["surnames"]) for e in entries)
        if total_surnames == 0:
            return
        log.info("Training on %d entries with %d total surnames", len(entries), total_surnames)

        for entry in entries:
            code = entry["code"]
            self.info[code] = {
                "name": entry["name"],
                "region": entry.get("region", entry["name"]),
            }

            ngram_counter = Counter()
            for surname in entry["surnames"]:
                surname = surname.lower().strip()
                ngrams = extract_ngrams(surname)
                ngram_counter.update(ngrams)
                self.vocab.update(ngrams)

            self.ngram_counts[code] = ngram_counter
            self.totals[code] = sum(ngram_counter.values())
            self.priors[code] = math.log(max(len(entry["surnames"]), 1) / total_surnames)

        log.info("Vocabulary size: %d n-grams, %d classes", len(self.vocab), len(self.info))

    def classify(self, surname):
        """Classify a surname, returning {code: probability} for all classes."""
        surname = surname.lower().strip()
        ngrams = extract_ngrams(surname)

        if not ngrams:
            return {}

        vocab_size = len(self.vocab)
        scores = {}

        for code in self.ngram_counts:
            log_prob = self.priors[code]
            counts = self.ngram_counts[code]
            total = self.totals[code]
            denom = total + self.smoothing * vocab_size

            for ng in ngrams:
                count = counts.get(ng, 0)
                log_prob += math.log((count + self.smoothing) / denom)

            scores[code] = log_prob

        # Convert log probs to normalized probabilities
        max_score = max(scores.values())
        exp_scores = {k: math.exp(v - max_score) for k, v in scores.items()}
        total_exp = sum(exp_scores.values())
        probs = {k: v / total_exp for k, v in exp_scores.items()}

        return probs


# Map each specific category to its fallback region
CATEGORY_TO_REGION = {
    "JP": "East Asian", "KR": "East Asian", "CN": "East Asian",
    "VN": "Southeast Asian", "PH": "Southeast Asian",
    "IN": "South Asian",
    "GR": "European", "GE": "European", "IT": "European",
    "NL": "European", "DE": "European", "HU": "European",
    "PL": "Slavic", "RU": "Slavic", "UA": "Slavic",
    "FI": "Scandinavian",
    "AM": "Middle Eastern", "TR": "Middle Eastern", "AR": "Middle Eastern",
    "PT": "Latino", "ES": "Latino",
    "IE": "Anglo", "GB": "Anglo",
    "NG": "African", "ET": "African",
}


def run(conn):
    cur = conn.cursor()

    # Create table if not exists
    log.info("Ensuring surname_origins table exists...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS surname_origins (
            surname TEXT PRIMARY KEY,
            country_code CHAR(2) NOT NULL,
            country_name TEXT NOT NULL,
            region TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_surname_origins_country ON surname_origins (country_code)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_surname_origins_region ON surname_origins (region)")
    conn.commit()

    # Load training data
    categories, fallback_groups = load_training_data()
    if not categories:
        log.error("No training data found!")
        return

    # Train specific-category classifier
    specific_model = NaiveBayesClassifier(smoothing=0.5)
    specific_model.train(categories)

    # Train fallback-region classifier
    # Merge: each fallback group gets its own names PLUS names from its child categories
    region_entries = {}
    for fg in fallback_groups:
        region_entries[fg["name"]] = {
            "code": fg["code"],
            "name": fg["name"],
            "surnames": list(fg["surnames"]),
        }

    # Add category surnames to their parent region
    for cat in categories:
        region = CATEGORY_TO_REGION.get(cat["code"])
        if region and region in region_entries:
            region_entries[region]["surnames"].extend(cat["surnames"])

    fallback_model = NaiveBayesClassifier(smoothing=0.5)
    fallback_model.train(list(region_entries.values()))

    # Build region code/name lookup
    region_info = {}
    for fg in fallback_groups:
        region_info[fg["name"]] = {"code": fg["code"], "name": fg["name"]}

    # Extract unique surnames from carrier_principals
    log.info("Extracting unique surnames from carrier_principals...")
    cur.execute("""
        SELECT DISTINCT
            reverse(split_part(reverse(officer_name_normalized), ' ', 1)) AS surname
        FROM carrier_principals
        WHERE officer_name_normalized LIKE '%% %%'
          AND officer_name_normalized IS NOT NULL
          AND LENGTH(officer_name_normalized) > 2
    """)
    raw_surnames = [row[0] for row in cur.fetchall()]
    log.info("Found %d raw unique last-name tokens", len(raw_surnames))

    # Clean surnames
    surname_set = set()
    for s in raw_surnames:
        s = s.strip().lower()
        if s in NAME_SUFFIXES:
            continue
        if len(s) < 2 or s.isdigit():
            continue
        # Remove non-alpha characters
        s = re.sub(r'[^a-z]', '', s)
        if len(s) >= 2:
            surname_set.add(s)

    surnames = sorted(surname_set)
    log.info("After cleanup: %d unique surnames to classify", len(surnames))

    # Clear existing data
    log.info("Clearing existing surname_origins data...")
    cur.execute("TRUNCATE surname_origins")
    conn.commit()

    # Classify each surname with hierarchical fallback
    batch = []
    stats = Counter()
    fallback_count = 0

    for i, surname in enumerate(surnames):
        # Step 1: Try specific category classification
        specific_probs = specific_model.classify(surname)
        if specific_probs:
            best_specific = max(specific_probs, key=specific_probs.get)
            specific_conf = specific_probs[best_specific]
        else:
            best_specific = None
            specific_conf = 0.0

        if specific_conf >= SPECIFIC_THRESHOLD:
            # High confidence — use specific category
            code = best_specific
            name = specific_model.info[code]["name"]
            region = specific_model.info[code]["region"]
            confidence = specific_conf
        else:
            # Low confidence — fall back to region classification
            fallback_probs = fallback_model.classify(surname)
            if fallback_probs:
                best_region_code = max(fallback_probs, key=fallback_probs.get)
                region_conf = fallback_probs[best_region_code]
                fb_info = fallback_model.info[best_region_code]
                code = best_region_code
                name = fb_info["name"]
                region = fb_info["name"]
                confidence = region_conf
            else:
                # Absolute last resort (should never happen)
                code = "XB"
                name = "Anglo"
                region = "Anglo"
                confidence = 0.0
            fallback_count += 1

        batch.append((
            surname,
            code,
            name,
            region,
            round(confidence, 4),
        ))
        stats[f"{code} ({name})"] += 1

        if len(batch) >= BATCH_SIZE:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO surname_origins (surname, country_code, country_name, region, confidence)
                   VALUES %s ON CONFLICT (surname) DO UPDATE SET
                   country_code = EXCLUDED.country_code,
                   country_name = EXCLUDED.country_name,
                   region = EXCLUDED.region,
                   confidence = EXCLUDED.confidence""",
                batch,
                page_size=BATCH_SIZE,
            )
            conn.commit()
            log.info("  Inserted %d / %d surnames...", i + 1, len(surnames))
            batch = []

    # Final batch
    if batch:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO surname_origins (surname, country_code, country_name, region, confidence)
               VALUES %s ON CONFLICT (surname) DO UPDATE SET
               country_code = EXCLUDED.country_code,
               country_name = EXCLUDED.country_name,
               region = EXCLUDED.region,
               confidence = EXCLUDED.confidence""",
            batch,
            page_size=BATCH_SIZE,
        )
        conn.commit()

    log.info("=== Classification complete ===")
    log.info("Total surnames classified: %d", len(surnames))
    log.info("Specific category matches: %d", len(surnames) - fallback_count)
    log.info("Fallback region matches:   %d", fallback_count)
    log.info("Unknowns:                  0 (zero — every name classified)")
    log.info("")
    log.info("Breakdown by category/region:")
    for label, count in stats.most_common(40):
        log.info("  %-35s %6d", label, count)

    # ── Compute dominant_origin per carrier for map overlay ──
    log.info("Computing dominant_origin per carrier...")
    cur.execute("ALTER TABLE carriers ADD COLUMN IF NOT EXISTS dominant_origin CHAR(2)")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_carriers_dominant_origin
        ON carriers (dominant_origin) WHERE dominant_origin IS NOT NULL
    """)
    conn.commit()

    cur.execute("""
        UPDATE carriers c
        SET dominant_origin = sub.dominant
        FROM (
            SELECT cp.dot_number,
                   (array_agg(so.country_code ORDER BY so.confidence DESC))[1] AS dominant
            FROM carrier_principals cp
            JOIN surname_origins so
                ON so.surname = reverse(split_part(reverse(cp.officer_name_normalized), ' ', 1))
            WHERE cp.officer_name_normalized LIKE '%% %%'
            GROUP BY cp.dot_number
        ) sub
        WHERE c.dot_number = sub.dot_number
    """)
    updated = cur.rowcount
    conn.commit()
    log.info("Updated dominant_origin for %d carriers", updated)


def main():
    log.info("Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL)
    try:
        run(conn)
    finally:
        conn.close()
    log.info("Done.")


if __name__ == "__main__":
    main()
