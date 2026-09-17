# medpark-hr

Python 3.11 + Flask + PostgreSQL migration test deployment for MedPark HR Maps.

This repository intentionally excludes production HR records, SQLite files,
credentials, and other private runtime data. The initial deployment validates
the Python/PostgreSQL runtime, administrator setup, authentication, static UI,
and database connectivity. Remaining business APIs return HTTP 501 until their
PostgreSQL migration is completed and verified.
