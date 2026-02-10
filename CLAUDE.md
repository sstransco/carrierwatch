# CarrierWatch

Public FMCSA carrier transparency platform. 4.39M motor carriers mapped and risk-scored, with chameleon carrier detection via address clustering, officer cross-referencing, and PPP loan matching. Built to make obfuscated trucking safety data visual and accessible.

**Stack:** PostGIS 16 + Martin MVT tiles + FastAPI (asyncpg) + React 19 / Mapbox GL JS (dark-v11)

## Architecture

```
Internet → Cloudflare → Nginx → ┬─ /api/*   → backend  (FastAPI :8000)
                                 ├─ /tiles/* → martin   (MVT :3000)
                                 └─ /*       → frontend (React :80)
                                 └─ postgres (PostGIS :5432)
```

**Dev ports (host):** postgres 5433, martin 3001, backend 8000, frontend 5173
**Prod:** nginx on 80/443 (Cloudflare SSL), postgres not exposed
**Domain:** carrier.watch

## Directory Structure

```
backend/          FastAPI app — main.py, database.py, models.py, routers/
  routers/        carriers, addresses, stats, history, principals, cdl_schools
frontend/src/     React 19 + TypeScript
  components/     13 components (Map, CarrierDetail, AddressDetail, CDLSchools, etc.)
  hooks/          useApi.ts
  types/          index.ts (CarrierSummary, CarrierDetail, AddressCluster, etc.)
pipeline/         Python data ingestion scripts (psycopg2, httpx)
database/         SQL migrations: 001_schema, 002_ppp_and_risk, 003_extended, 004_principals_eld_cdl
nginx/            nginx.conf (dev), nginx-ssl.conf (prod with Cloudflare origin certs)
ssl/              Cloudflare origin certificates
data/             Raw data files (gitignored): census.csv, violations.csv, cdl_schools.xlsx
```

## Database Schema

**Extensions:** postgis, pg_trgm

| Table | PK | Rows | Description |
|-------|-----|------|-------------|
| carriers | dot_number (int) | 4.39M | Core carrier records, geocoded locations, risk scores |
| inspections | inspection_id (bigint) | 8.2M | Roadside inspections with violation/OOS totals |
| inspection_violations | id (serial) | ~13M | Per-violation detail (code, description, OOS, category) |
| crashes | (crash_id, report_seq_no) | 2.4M | Crash records with fatalities, injuries, conditions |
| authority_history | id (serial) | 1.8M | Common/contract/broker authority snapshots |
| insurance_history | id (serial) | 7.3M | Insurance policies with effective/cancellation dates |
| ppp_loans | loan_id (serial) | 5.5M | SBA PPP loans, 564K matched to carriers |
| carrier_principals | id (serial) | 4.47M | Company officers (3.39M unique normalized names) |
| cdl_schools | id (serial) | 31,780 | CDL training providers from FMCSA TPR |

**Materialized Views:**
- `address_clusters` — carriers grouped by address_hash (HAVING count >= 2), with centroid
- `officer_carrier_counts` — officers grouped by normalized name with carrier_count and dot_numbers array

**MVT Functions (Martin):**
- `carriers_mvt(z, x, y)` — carrier points with risk_score, status, safety
- `address_clusters_mvt(z, x, y)` — clusters with zoom-dependent min_count (z4=20, z7=5, z10+=2)
- `cdl_schools_mvt(z, x, y)` — CDL school points

**Key column — address_hash:**
Format: `SHA-256(ADDR|CITY|STATE|ZIP)[:16]` with street abbreviation normalization (STREET→ST, AVENUE→AVE, etc.) and pipe separators. All tables sharing address data (carriers, ppp_loans, cdl_schools) MUST use this exact format.

## Backend API

**Connection:** asyncpg pool (min=5, max=20) via `database.py:get_conn()`
**Rate limit:** 200/min (slowapi)
**CORS:** from `CORS_ORIGINS` env var

| Router | Prefix | Key Endpoints |
|--------|--------|---------------|
| carriers | `/api/carriers` | `GET /search`, `GET /top-risk`, `GET /{dot_number}`, `GET /` |
| addresses | `/api/addresses` | `GET /top-flagged`, `GET /{address_hash}` |
| stats | `/api` | `GET /stats` (5-min cache, single FILTER query) |
| history | `/api` | `GET /carriers/{dot}/inspections\|violations\|crashes\|authority\|insurance` |
| principals | `/api/principals` | `GET /search`, `GET /top`, `GET /carrier/{dot_number}` |
| cdl_schools | `/api/cdl-schools` | `GET /`, `GET /at-carrier-addresses`, `GET /stats` |

Health check: `GET /health`

## Frontend

**Routes:** `/` (map), `/carrier/:dotNumber`, `/address/:addressHash`, `/principals`, `/cdl-schools`, `/about`
**Map layers:** risk, clusters, carriers, heatmap, cdl-schools (toggle via LayerToggle)
**Env vars:** `VITE_API_URL`, `VITE_TILES_URL`, `VITE_MAPBOX_TOKEN`

## Pipeline Scripts

Run order matters. Each script: `cd pipeline && DATABASE_URL=postgresql://... python3 script.py`

| # | Script | What it does |
|---|--------|-------------|
| 1 | `ingest.py` | Downloads FMCSA census CSV from DOT DataHub (az4n-8mr2), bulk upserts 4.39M carriers |
| 2 | `geocode.py` | Census Bureau batch geocoder, 10K per batch, 84.5% success rate (3.7M geocoded) |
| 3 | `ppp_ingest.py` | SBA PPP loan data, address+name matching to carriers |
| 4 | `extended_ingest.py` | Inspections, crashes, authority, insurance from Socrata APIs |
| 5 | `principals_ingest.py` | Officer/principal extraction from census CSV |
| 6 | `violations_ingest.py` | Per-violation detail from dataset 876r-jsdb |
| 7 | `cdl_schools_ingest.py` | FMCSA Training Provider Registry from Excel export |
| 8 | `geocode_cdl.py` | Geocode CDL school addresses |
| 9 | `apply_risk_flags.py` | Compute all risk flags (run AFTER geocoding to avoid deadlocks) |
| 10 | `rehash_addresses.py` | Utility to recalculate address hashes |

Config: `pipeline/config.py` — DATABASE_URL, DATA_DIR, Socrata URLs, column mappings

## Risk Scoring System

Stored on `carriers` table: `risk_score` (integer), `risk_flags` (text[])

| Flag | Points | Source |
|------|--------|--------|
| ADDRESS_OVERLAP_25+ | +50 | address_clusters with 25+ carriers |
| ADDRESS_OVERLAP_10+ | +35 | address_clusters with 10+ carriers |
| ADDRESS_OVERLAP_5+ | +20 | address_clusters with 5+ carriers |
| OFFICER_25_PLUS | +50 | Officer linked to 25+ carriers |
| OFFICER_10_PLUS | +35 | Officer linked to 10+ carriers |
| OFFICER_5_PLUS | +20 | Officer linked to 5+ carriers |
| FATAL_CRASHES | +25 | Any fatal crash on record |
| ELD_VIOLATIONS_5_PLUS | +25 | 5+ ELD (Part 395) violations |
| HIGH_VEHICLE_OOS | +20 | Vehicle OOS rate > 30% |
| LARGE_PPP_LOAN | +20 | PPP loan > $100K |
| INSURANCE_LAPSE | +20 | Insurance lapse detected |
| NEW_AUTHORITY | +15 | Authority < 1 year old |
| HIGH_CRASH_COUNT | +15 | 3+ crashes (non-fatal) |
| HIGH_DRIVER_OOS | +15 | Driver OOS rate > 20% |
| AUTHORITY_REVOKED_REISSUED | +15 | Authority revocation pending |
| PO_BOX_ADDRESS | +15 | PO Box as physical address (illegal for carriers) |
| PPP_FORGIVEN_CLUSTER | +15 | PPP forgiven at multi-carrier address |
| PPP_LOAN | +10 | Any PPP loan received |
| NO_PHYSICAL_ADDRESS | +10 | Missing/fake physical address |
| INACTIVE_STATUS | +10 | Inactive but at clustered address |

High-risk threshold: score >= 50 (~240K carriers)

## Common Tasks

**Local dev:**
```bash
docker compose up
```

**Run a pipeline script:**
```bash
cd pipeline && DATABASE_URL=postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5433/carrierwatch python3 ingest.py
```

**Refresh materialized views:**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY address_clusters;
REFRESH MATERIALIZED VIEW officer_carrier_counts;
```

**Add a new API endpoint:**
1. Create or edit router in `backend/routers/`
2. Register in `backend/main.py` with `app.include_router()`

**Production deploy (from Desktop/CARRIERWATCH):**
```bash
# 1. Rsync to server (always exclude .env to protect prod secrets)
rsync -avz --progress -e "ssh -i ~/.ssh/carrierwatch" \
  --exclude 'node_modules' --exclude '.git' --exclude 'data/' \
  --exclude 'postgres_data' --exclude '__pycache__' --exclude '.env' --exclude 'venv' \
  ./ root@64.23.142.235:/opt/carrierwatch/

# 2. Rebuild and restart on server
ssh -i ~/.ssh/carrierwatch root@64.23.142.235 "cd /opt/carrierwatch && \
  docker compose -f docker-compose.prod.yml build --no-cache frontend && \
  docker compose -f docker-compose.prod.yml up -d frontend && \
  docker compose -f docker-compose.prod.yml restart nginx"

# For backend changes, replace 'frontend' with 'backend' (or omit service name to rebuild all)
# ALWAYS restart nginx after rebuilding — it caches DNS at startup
```

**SSH access:** `ssh -i ~/.ssh/carrierwatch root@64.23.142.235` (dedicated key)
**Server path:** `/opt/carrierwatch`
**Domain:** carrier.watch (Cloudflare DNS/CDN → DigitalOcean 64.23.142.235)

**Git (from Documents/CARRIERWATCH):**
```bash
# Commit and push (Documents repo is the git repo, Desktop is the deploy source)
cd /Users/maxwell/Documents/CARRIERWATCH
git add -A && git commit -m "description"
git push origin main
```

## Known Pitfalls

**Deadlocks:** Long-running UPDATEs on `carriers` (geocoding, risk flags) deadlock with each other and with autovacuum. Mitigations:
- Use `FOR UPDATE SKIP LOCKED` in batch updates
- Temporarily disable autovacuum: `ALTER TABLE carriers SET (autovacuum_enabled = false)` then re-enable after
- Run `apply_risk_flags.py` AFTER geocoding completes, not concurrently

**Violations CSV (876r-jsdb):** Column names are UPPERCASE. There is no DOT_NUMBER column — must backfill via JOIN on inspection_id to inspections table. Violation code = `PART_NO.PART_NO_SECTION`.

**Census CSV dates:** Format is `YYYYMMDD` (no slashes), handled by `parse_date()` in ingest.py.

**Address hash format:** MUST use pipe `|` separator + street abbreviation normalization + SHA-256[:16]. CDL schools, PPP loans, and any new data source MUST match this format exactly or cross-referencing breaks silently.

**Python compatibility:** Use `from __future__ import annotations` in all pipeline scripts for Python 3.9 compat.

**TypeScript:** Use `window.setTimeout` (returns `number`) not `setTimeout` (returns `NodeJS.Timeout`) for browser timeout refs.

**Stats endpoint:** Under heavy IO, the stats query can be slow. Uses 5-min in-memory cache and a single combined query with PostgreSQL `FILTER (WHERE ...)` expressions instead of sequential COUNTs.

**Nginx tile caching:** Martin tiles cached 2h at nginx layer (`/tiles/*` → martin with `proxy_cache`). API responses cached 5min. Both use `stale` on error/timeout.

**MVT spatial indexes:** The `location`/`centroid` columns are `geography` type, but MVT functions cast them to `::geometry`. A GIST index on the geography column does NOT help — you need expression indexes on `(column::geometry)`. All three exist: `idx_carriers_location_geom`, `idx_address_clusters_centroid_geom`, `idx_cdl_schools_location_geom`. Without these, tile queries do full table scans on 4.39M rows.

**Tile URLs must be absolute:** Mapbox GL JS web workers can't resolve relative URLs. The frontend TILES_URL IIFE ensures URLs always start with `https://` by prepending `window.location.origin` when `VITE_TILES_URL` isn't set or is relative.
