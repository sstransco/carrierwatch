from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_conn

router = APIRouter(prefix="/api/network", tags=["network"])


@router.get("/officer/{officer_name}/clusters")
async def officer_clusters(officer_name: str):
    """Return identity clusters for an officer name."""
    pool = await get_conn()
    name_norm = officer_name.strip().lower()
    rows = await pool.fetch(
        """
        SELECT cluster_index, carrier_count, link_signals,
               total_crashes, fatal_crashes, total_units,
               avg_risk_score, states
        FROM officer_network_clusters
        WHERE officer_name_normalized = $1
        ORDER BY carrier_count DESC
        """,
        name_norm,
    )
    return [dict(r) for r in rows]


@router.get("/officer/{officer_name}")
async def officer_network(
    officer_name: str,
    max_carriers: int = Query(80, ge=10, le=200),
    depth: int = Query(1, ge=0, le=2),
    cluster: int | None = Query(None),
):
    """
    Build a network graph for an officer.
    Returns nodes (officers + carriers) and edges (officer->carrier links).

    depth=0: just the officer and their carriers
    depth=1: also show co-officers on those carriers
    depth=2: also show co-officers' other carriers (limited)
    """
    pool = await get_conn()
    name_norm = officer_name.strip().lower()

    # If cluster param provided, fetch the member dot_numbers to filter by
    cluster_dots: list[int] | None = None
    if cluster is not None:
        row = await pool.fetchrow(
            """
            SELECT member_dot_numbers
            FROM officer_network_clusters
            WHERE officer_name_normalized = $1 AND cluster_index = $2
            """,
            name_norm, cluster,
        )
        if row and row["member_dot_numbers"]:
            cluster_dots = list(row["member_dot_numbers"])

    # 1. Get the target officer's carriers (top by risk_score, crash count)
    if cluster_dots is not None:
        carrier_rows = await pool.fetch(
            """
            SELECT DISTINCT cp.dot_number,
                   c.legal_name, c.operating_status, c.physical_state,
                   COALESCE(c.risk_score, 0) AS risk_score,
                   COALESCE(c.power_units, 0) AS power_units,
                   COALESCE(c.total_crashes, 0) AS total_crashes,
                   COALESCE(c.fatal_crashes, 0) AS fatal_crashes,
                   cp.officer_position, cp.email
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            WHERE cp.officer_name_normalized = $1
              AND cp.dot_number = ANY($2::integer[])
            ORDER BY risk_score DESC NULLS LAST, total_crashes DESC NULLS LAST
            """,
            name_norm, cluster_dots,
        )
    else:
        carrier_rows = await pool.fetch(
            """
            SELECT DISTINCT cp.dot_number,
                   c.legal_name, c.operating_status, c.physical_state,
                   COALESCE(c.risk_score, 0) AS risk_score,
                   COALESCE(c.power_units, 0) AS power_units,
                   COALESCE(c.total_crashes, 0) AS total_crashes,
                   COALESCE(c.fatal_crashes, 0) AS fatal_crashes,
                   cp.officer_position, cp.email
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            WHERE cp.officer_name_normalized = $1
            ORDER BY risk_score DESC NULLS LAST, total_crashes DESC NULLS LAST
            LIMIT $2
            """,
            name_norm, max_carriers,
        )

    if not carrier_rows:
        return {"nodes": [], "edges": [], "stats": {}}

    dot_numbers = [r["dot_number"] for r in carrier_rows]

    # Build initial nodes and edges
    nodes = {}
    edges = []

    # Officer node
    officer_id = f"officer:{name_norm}"
    nodes[officer_id] = {
        "id": officer_id,
        "type": "officer",
        "label": name_norm.title(),
        "carrier_count": len(carrier_rows),
    }

    # Carrier nodes
    for r in carrier_rows:
        cid = f"carrier:{r['dot_number']}"
        nodes[cid] = {
            "id": cid,
            "type": "carrier",
            "label": r["legal_name"] or f"DOT# {r['dot_number']}",
            "dot_number": r["dot_number"],
            "risk_score": r["risk_score"],
            "power_units": r["power_units"],
            "total_crashes": r["total_crashes"],
            "fatal_crashes": r["fatal_crashes"],
            "operating_status": r["operating_status"],
            "state": r["physical_state"],
        }
        edges.append({
            "source": officer_id,
            "target": cid,
            "position": r["officer_position"],
            "email": r["email"],
        })

    if depth >= 1 and dot_numbers:
        # 2. Get co-officers on those carriers
        co_rows = await pool.fetch(
            """
            SELECT cp.officer_name_normalized, cp.dot_number, cp.officer_position, cp.email,
                   COALESCE(occ.carrier_count, 1) AS total_carrier_count
            FROM carrier_principals cp
            LEFT JOIN officer_carrier_counts occ
                ON occ.officer_name_normalized = cp.officer_name_normalized
            WHERE cp.dot_number = ANY($1::integer[])
              AND cp.officer_name_normalized != $2
            ORDER BY occ.carrier_count DESC NULLS LAST
            """,
            dot_numbers, name_norm,
        )

        co_officer_carriers: dict[str, list[int]] = {}
        for r in co_rows:
            co_name = r["officer_name_normalized"]
            co_id = f"officer:{co_name}"
            co_dot = r["dot_number"]
            cid = f"carrier:{co_dot}"

            if co_id not in nodes:
                nodes[co_id] = {
                    "id": co_id,
                    "type": "officer",
                    "label": co_name.title(),
                    "carrier_count": r["total_carrier_count"],
                }

            edges.append({
                "source": co_id,
                "target": cid,
                "position": r["officer_position"],
                "email": r["email"],
            })

            if co_name not in co_officer_carriers:
                co_officer_carriers[co_name] = []
            co_officer_carriers[co_name].append(co_dot)

        if depth >= 2:
            # 3. Get other carriers of the top co-officers (limited)
            top_co_officers = sorted(
                co_officer_carriers.keys(),
                key=lambda n: len(co_officer_carriers[n]),
                reverse=True,
            )[:10]

            for co_name in top_co_officers:
                extra_rows = await pool.fetch(
                    """
                    SELECT DISTINCT cp.dot_number,
                           c.legal_name, c.operating_status, c.physical_state,
                           COALESCE(c.risk_score, 0) AS risk_score,
                           COALESCE(c.power_units, 0) AS power_units,
                           COALESCE(c.total_crashes, 0) AS total_crashes,
                           COALESCE(c.fatal_crashes, 0) AS fatal_crashes,
                           cp.officer_position
                    FROM carrier_principals cp
                    JOIN carriers c ON c.dot_number = cp.dot_number
                    WHERE cp.officer_name_normalized = $1
                      AND cp.dot_number != ALL($2::integer[])
                    ORDER BY risk_score DESC NULLS LAST
                    LIMIT 5
                    """,
                    co_name, dot_numbers,
                )

                co_id = f"officer:{co_name}"
                for r in extra_rows:
                    cid = f"carrier:{r['dot_number']}"
                    if cid not in nodes:
                        nodes[cid] = {
                            "id": cid,
                            "type": "carrier",
                            "label": r["legal_name"] or f"DOT# {r['dot_number']}",
                            "dot_number": r["dot_number"],
                            "risk_score": r["risk_score"],
                            "power_units": r["power_units"],
                            "total_crashes": r["total_crashes"],
                            "fatal_crashes": r["fatal_crashes"],
                            "operating_status": r["operating_status"],
                            "state": r["physical_state"],
                        }
                    edges.append({
                        "source": co_id,
                        "target": cid,
                        "position": r["officer_position"],
                    })

    # Compute aggregate stats
    total_crashes = sum(
        n.get("total_crashes", 0) for n in nodes.values() if n["type"] == "carrier"
    )
    total_fatal = sum(
        n.get("fatal_crashes", 0) for n in nodes.values() if n["type"] == "carrier"
    )
    total_units = sum(
        n.get("power_units", 0) for n in nodes.values() if n["type"] == "carrier"
    )
    carrier_count = sum(1 for n in nodes.values() if n["type"] == "carrier")
    officer_count = sum(1 for n in nodes.values() if n["type"] == "officer")

    # Deduplicate edges
    seen_edges = set()
    unique_edges = []
    for e in edges:
        key = (e["source"], e["target"])
        if key not in seen_edges:
            seen_edges.add(key)
            unique_edges.append(e)

    return {
        "nodes": list(nodes.values()),
        "edges": unique_edges,
        "stats": {
            "carrier_count": carrier_count,
            "officer_count": officer_count,
            "total_crashes": total_crashes,
            "total_fatal": total_fatal,
            "total_power_units": total_units,
        },
    }
