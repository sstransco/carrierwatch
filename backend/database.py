import os
from contextlib import asynccontextmanager

import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5432/carrierwatch",
)

pool: asyncpg.Pool | None = None


async def init_pool():
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)


async def close_pool():
    global pool
    if pool:
        await pool.close()


async def get_conn():
    return pool
