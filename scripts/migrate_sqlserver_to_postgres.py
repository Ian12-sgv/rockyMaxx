from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Sequence

import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = ROOT / "docs" / "database" / "sqlserver_to_postgres_data_migration_report.json"
NUMERIC_TYPES = {
    "smallint",
    "integer",
    "bigint",
    "numeric",
    "decimal",
    "real",
    "double precision",
}
SQLCMD_BASE_ARGS = ("-W", "-h", "-1", "-w", "65535", "-y", "0", "-Y", "0")
SKIP_TABLES = {"sysdiagrams"}


@dataclass(frozen=True)
class SqlServerConfig:
    server: str
    database: str
    user: str
    password: str


def sql_ident(name: str) -> str:
    return f"[{name.replace(']', ']]')}]"


def pg_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def sql_literal(value: str) -> str:
    return "N'" + value.replace("'", "''") + "'"


def connect_postgres(host: str, database: str, user: str, password: str) -> psycopg2.extensions.connection:
    return psycopg2.connect(host=host, dbname=database, user=user, password=password)


def run_sqlcmd(config: SqlServerConfig, query: str) -> str:
    command = [
        "sqlcmd",
        "-S",
        config.server,
        "-U",
        config.user,
        "-P",
        config.password,
        "-C",
        "-d",
        config.database,
        *SQLCMD_BASE_ARGS,
        "-Q",
        f"SET NOCOUNT ON; {query}",
    ]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "sqlcmd failed"
        raise RuntimeError(detail)
    return completed.stdout.strip()


def run_sqlcmd_lines(config: SqlServerConfig, query: str) -> list[str]:
    output = run_sqlcmd(config, query)
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def run_sqlcmd_json(config: SqlServerConfig, query: str) -> list[dict]:
    output = run_sqlcmd(config, query)
    if not output:
        return []
    return json.loads(output, parse_float=Decimal, parse_int=int)


def fetch_source_tables(config: SqlServerConfig) -> list[str]:
    tables = run_sqlcmd_lines(
        config,
        """
        SELECT t.name
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo'
        ORDER BY t.name
        """,
    )
    return [table for table in tables if table not in SKIP_TABLES]


def fetch_source_columns(config: SqlServerConfig, table_name: str) -> list[str]:
    return run_sqlcmd_lines(
        config,
        f"""
        SELECT c.name
        FROM sys.columns c
        JOIN sys.tables t ON t.object_id = c.object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo' AND t.name = {sql_literal(table_name)}
        ORDER BY c.column_id
        """,
    )


def fetch_source_rows(config: SqlServerConfig, table_name: str, select_columns: Sequence[str]) -> list[dict]:
    projection = ", ".join(sql_ident(column) for column in select_columns)
    query = f"SELECT COALESCE((SELECT {projection} FROM dbo.{sql_ident(table_name)} FOR JSON PATH, INCLUDE_NULL_VALUES), '[]');"
    return run_sqlcmd_json(config, query)


def fetch_source_count(config: SqlServerConfig, table_name: str) -> int:
    output = run_sqlcmd(config, f"SELECT COUNT_BIG(*) FROM dbo.{sql_ident(table_name)};")
    return int(output or 0)


def fetch_target_columns(conn: psycopg2.extensions.connection, table_name: str) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'dbo' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table_name,),
        )
        return [(row[0], row[1]) for row in cur.fetchall()]


def fetch_target_tables(conn: psycopg2.extensions.connection) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'dbo' AND c.relkind = 'r'
            ORDER BY c.relname
            """
        )
        return [row[0] for row in cur.fetchall()]


def truncate_target_tables(conn: psycopg2.extensions.connection) -> None:
    tables = fetch_target_tables(conn)
    if not tables:
        return
    joined = ", ".join(f"dbo.{pg_ident(name)}" for name in tables)
    with conn.cursor() as cur:
        cur.execute("SET session_replication_role = replica")
        cur.execute(f"TRUNCATE TABLE {joined} RESTART IDENTITY CASCADE")
    conn.commit()


def normalize_value(value, target_type: str):
    if isinstance(value, bool) and target_type in NUMERIC_TYPES:
        return int(value)
    if isinstance(value, str):
        return value.replace("\x00", "")
    return value


def load_table(
    src_config: SqlServerConfig,
    pg_conn: psycopg2.extensions.connection,
    table_name: str,
    batch_size: int,
) -> dict:
    source_columns = fetch_source_columns(src_config, table_name)
    target_columns = fetch_target_columns(pg_conn, table_name)
    if not target_columns:
        raise RuntimeError(f"La tabla destino dbo.{table_name} no existe en PostgreSQL")

    source_lookup = {name.lower(): name for name in source_columns}
    common = [(name, data_type) for name, data_type in target_columns if name.lower() in source_lookup]
    if len(common) != len(target_columns):
        missing = [name for name, _ in target_columns if name.lower() not in source_lookup]
        raise RuntimeError(f"Faltan columnas en origen para dbo.{table_name}: {missing}")

    target_names = [name for name, _ in common]
    source_names = [source_lookup[name.lower()] for name in target_names]
    target_types = {name: data_type for name, data_type in common}

    source_rows = fetch_source_rows(src_config, table_name, source_names)
    insert_sql = f"INSERT INTO dbo.{pg_ident(table_name)} ({', '.join(pg_ident(c) for c in target_names)}) VALUES %s"

    inserted = 0
    with pg_conn.cursor() as pg_cur:
        for offset in range(0, len(source_rows), batch_size):
            batch = source_rows[offset : offset + batch_size]
            payload = [
                tuple(normalize_value(row.get(source_name), target_types[target_name]) for source_name, target_name in zip(source_names, target_names))
                for row in batch
            ]
            if payload:
                execute_values(pg_cur, insert_sql, payload, page_size=batch_size)
                inserted += len(payload)
    pg_conn.commit()

    source_count = fetch_source_count(src_config, table_name)
    with pg_conn.cursor() as pg_cur:
        pg_cur.execute(f"SELECT COUNT(*) FROM dbo.{pg_ident(table_name)}")
        target_count = int(pg_cur.fetchone()[0])

    return {
        "table": table_name,
        "source_count": source_count,
        "target_count": target_count,
        "inserted": inserted,
        "status": "ok" if source_count == target_count else "count_mismatch",
    }


def reset_sequences(conn: psycopg2.extensions.connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'dbo' AND column_default LIKE 'nextval(%'
            ORDER BY table_name, ordinal_position
            """
        )
        rows = cur.fetchall()

    with conn.cursor() as cur:
        for table_name, column_name in rows:
            qualified_table = f'dbo.{pg_ident(table_name)}'
            cur.execute("SELECT pg_get_serial_sequence(%s, %s)", (qualified_table, column_name))
            seq_name = cur.fetchone()[0]
            if not seq_name:
                continue

            cur.execute(f"SELECT MAX({pg_ident(column_name)}) FROM {qualified_table}")
            max_value = cur.fetchone()[0]
            schema_name, sequence_name = seq_name.split('.', 1)
            sequence_name = sequence_name.strip('"')
            cur.execute(
                "SELECT min_value FROM pg_sequences WHERE schemaname = %s AND sequencename = %s",
                (schema_name, sequence_name),
            )
            result = cur.fetchone()
            min_value = result[0] if result else 1

            if max_value is None:
                cur.execute("SELECT setval(%s::regclass, %s, false)", (seq_name, min_value))
            else:
                cur.execute("SELECT setval(%s::regclass, %s, true)", (seq_name, max_value))
    conn.commit()


def compare_counts(results: Sequence[dict]) -> dict:
    mismatches = [row for row in results if row["source_count"] != row["target_count"]]
    return {
        "tables_total": len(results),
        "tables_ok": len(results) - len(mismatches),
        "tables_mismatch": len(mismatches),
        "mismatches": mismatches,
    }


def write_report(report_path: Path, payload: dict) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrar datos de SQL Server MODELOBD a PostgreSQL rocky maxx")
    parser.add_argument("--sql-server", default=r"IAN\IAN")
    parser.add_argument("--sql-database", default="MODELOBD")
    parser.add_argument("--sql-user", default="sa")
    parser.add_argument("--sql-password", default="123456")
    parser.add_argument("--pg-host", default="localhost")
    parser.add_argument("--pg-database", default="rocky maxx")
    parser.add_argument("--pg-user", default="postgres")
    parser.add_argument("--pg-password", default="123456")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    src_config = SqlServerConfig(
        server=args.sql_server,
        database=args.sql_database,
        user=args.sql_user,
        password=args.sql_password,
    )
    pg_conn = connect_postgres(args.pg_host, args.pg_database, args.pg_user, args.pg_password)

    try:
        source_tables = fetch_source_tables(src_config)
        truncate_target_tables(pg_conn)

        with pg_conn.cursor() as cur:
            cur.execute("SET session_replication_role = replica")
        pg_conn.commit()

        results = []
        for table_name in source_tables:
            result = load_table(src_config, pg_conn, table_name, args.batch_size)
            results.append(result)
            print(f"{table_name}: {result['source_count']} -> {result['target_count']} ({result['status']})")

        reset_sequences(pg_conn)

        with pg_conn.cursor() as cur:
            cur.execute("SET session_replication_role = origin")
        pg_conn.commit()

        summary = compare_counts(results)
        report = {
            "sql_server": {
                "server": args.sql_server,
                "database": args.sql_database,
            },
            "postgres": {
                "host": args.pg_host,
                "database": args.pg_database,
            },
            "summary": summary,
            "tables": results,
        }
        write_report(args.report, report)
        print(f"Report written to {args.report}")
        return 0 if summary["tables_mismatch"] == 0 else 1
    finally:
        try:
            with pg_conn.cursor() as cur:
                cur.execute("SET session_replication_role = origin")
            pg_conn.commit()
        except Exception:
            pg_conn.rollback()
        pg_conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
