from __future__ import annotations

import csv
import os
from collections import Counter, defaultdict
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(os.environ.get("SQLSERVER_EXPORT_DIR", r"f:\ian\base de datos"))
OUTPUT_SQL = ROOT / "database" / "postgres" / "legacy_mirror.sql"
OUTPUT_REPORT = ROOT / "docs" / "database" / "postgres-exact-mirror.md"

COLUMN_HEADERS = [
    "schema_name",
    "table_name",
    "column_id",
    "column_name",
    "data_type",
    "max_length",
    "precision",
    "scale",
    "is_nullable",
    "is_identity",
    "identity_seed",
    "identity_increment",
    "default_definition",
    "is_computed",
    "collation_name",
]
CONSTRAINT_HEADERS = [
    "schema_name",
    "table_name",
    "constraint_type",
    "constraint_name",
    "key_columns",
]
FK_HEADERS = [
    "fk_name",
    "parent_schema",
    "parent_table",
    "parent_column",
    "referenced_schema",
    "referenced_table",
    "referenced_column",
    "constraint_column_id",
    "delete_action",
    "update_action",
]
INDEX_HEADERS = [
    "schema_name",
    "table_name",
    "index_name",
    "type_desc",
    "is_unique",
    "is_primary_key",
    "is_unique_constraint",
    "is_disabled",
    "key_columns",
    "included_columns",
]
TABLE_HEADERS = ["schema_name", "table_name", "row_count"]
MODULE_HEADERS = ["schema_name", "object_name", "type_desc", "definition"]


def find_file(predicate):
    for name in os.listdir(SOURCE_DIR):
        if predicate(name):
            return SOURCE_DIR / name
    raise FileNotFoundError(predicate)


def load_csv(path: Path, headers: list[str]) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, fieldnames=headers)
        return list(reader)


def qident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def split_columns(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def strip_wrapping_parens(expr: str) -> str:
    expr = expr.strip()
    while expr.startswith("(") and expr.endswith(")"):
        depth = 0
        balanced = True
        for idx, ch in enumerate(expr):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0 and idx != len(expr) - 1:
                    balanced = False
                    break
        if balanced and depth == 0:
            expr = expr[1:-1].strip()
        else:
            break
    return expr


def sqlserver_to_pg_type(col: dict[str, str]) -> str:
    data_type = col["data_type"].lower()
    max_length = int(col["max_length"])
    precision = int(col["precision"])
    scale = int(col["scale"])

    if data_type == "bigint":
        return "bigint"
    if data_type == "int":
        return "integer"
    if data_type == "smallint":
        return "smallint"
    if data_type == "tinyint":
        return "smallint"
    if data_type == "bit":
        return "boolean"
    if data_type in {"numeric", "decimal"}:
        return f"numeric({precision},{scale})"
    if data_type == "varchar":
        return "text" if max_length == -1 else f"varchar({max_length})"
    if data_type == "sysname":
        return "varchar(128)"
    if data_type == "varbinary":
        return "bytea"
    if data_type == "smalldatetime":
        return "timestamp(0) without time zone"
    if data_type == "datetime":
        return "timestamp(3) without time zone"
    raise ValueError(f"Unsupported SQL Server type: {data_type}")


def normalize_default(expr: str, pg_type: str) -> tuple[str | None, str | None]:
    if not expr or expr == "NULL":
        return None, None

    raw = expr.strip()
    unwrapped = strip_wrapping_parens(raw)
    lowered = unwrapped.lower()

    if lowered == "getdate()":
        return "CURRENT_TIMESTAMP", None

    if pg_type == "boolean" and unwrapped in {"0", "1"}:
        return ("FALSE" if unwrapped == "0" else "TRUE"), None

    if re.fullmatch(r"-?\d+(?:\.\d+)?", unwrapped):
        return unwrapped, None

    if (unwrapped.startswith("'") and unwrapped.endswith("'")) or (
        unwrapped.startswith("N'") and unwrapped.endswith("'")
    ):
        return (unwrapped[1:] if unwrapped.startswith("N'") else unwrapped), None

    return None, raw


def map_action(action: str) -> str:
    action = action.replace("_", " ").upper()
    if action in {"NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT"}:
        return action
    raise ValueError(f"Unsupported referential action: {action}")


def main() -> None:
    tables = load_csv(find_file(lambda n: n.startswith("Tablas y conteo")), TABLE_HEADERS)
    columns = load_csv(find_file(lambda n: n.startswith("Columnas, tipos")), COLUMN_HEADERS)
    constraints = load_csv(find_file(lambda n: n.startswith("Claves primarias")), CONSTRAINT_HEADERS)
    fks = load_csv(find_file(lambda n: n.startswith("Claves for")), FK_HEADERS)
    indexes = load_csv(find_file(lambda n: n.endswith("incluidas.csv")), INDEX_HEADERS)
    modules = load_csv(find_file(lambda n: n.startswith("Triggers, vistas")), MODULE_HEADERS)

    table_order = [row["table_name"] for row in tables if row["schema_name"] == "dbo"]
    columns_by_table: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in columns:
        if row["schema_name"] == "dbo":
            columns_by_table[row["table_name"]].append(row)
    for table in columns_by_table:
        columns_by_table[table].sort(key=lambda row: int(row["column_id"]))

    constraints_by_table: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in constraints:
        if row["schema_name"] == "dbo":
            constraints_by_table[row["table_name"]].append(row)

    fk_order: list[str] = []
    fk_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in fks:
        if row["parent_schema"] != "dbo":
            continue
        if row["fk_name"] not in fk_groups:
            fk_order.append(row["fk_name"])
        fk_groups[row["fk_name"]].append(row)
    for fk_name in fk_groups:
        fk_groups[fk_name].sort(key=lambda row: int(row["constraint_column_id"]))

    collations = Counter(row["collation_name"] for row in columns if row["collation_name"] != "NULL")
    identity_columns = [row for row in columns if row["is_identity"] == "1" and row["schema_name"] == "dbo"]
    unsupported_defaults: list[str] = []
    unsupported_types: list[str] = []

    lines: list[str] = []
    lines.append("-- Generated from SQL Server metadata exports.")
    lines.append("-- Source database: MODELOBD")
    lines.append("-- Goal: PostgreSQL legacy mirror with exact table, column, PK, unique and FK shape where the engines allow it.")
    lines.append("-- SQL Server programmable objects are inventoried separately because they require T-SQL to PL/pgSQL rewrites.")
    lines.append("")
    lines.append("BEGIN;")
    lines.append("")
    lines.append("CREATE SCHEMA IF NOT EXISTS dbo;")
    lines.append("")

    for table_name in table_order:
        table_columns = columns_by_table.get(table_name, [])
        if not table_columns:
            continue

        lines.append(f"CREATE TABLE IF NOT EXISTS dbo.{qident(table_name)} (")
        rendered_columns: list[str] = []
        for col in table_columns:
            try:
                pg_type = sqlserver_to_pg_type(col)
            except ValueError as exc:
                unsupported_types.append(str(exc))
                raise
            pieces = [f"  {qident(col['column_name'])}", pg_type]
            default_sql, unsupported_default = normalize_default(col["default_definition"], pg_type)
            if default_sql is not None:
                pieces.append(f"DEFAULT {default_sql}")
            elif unsupported_default is not None:
                unsupported_defaults.append(
                    f"{table_name}.{col['column_name']} -> {unsupported_default}"
                )
            if col["is_nullable"] == "0":
                pieces.append("NOT NULL")
            rendered_columns.append(" ".join(pieces))
        lines.append(",\n".join(rendered_columns))
        lines.append(");")
        lines.append("")

    for col in identity_columns:
        seq_name = f"SQ_{col['table_name']}_{col['column_name']}"
        seed = int(col["identity_seed"]) if col["identity_seed"] != "NULL" else 1
        increment = int(col["identity_increment"]) if col["identity_increment"] != "NULL" else 1
        minvalue_sql = f" MINVALUE {seed}" if seed <= 0 else ""
        lines.append(
            f"CREATE SEQUENCE IF NOT EXISTS dbo.{qident(seq_name)} START WITH {seed}{minvalue_sql} INCREMENT BY {increment};"
        )
        lines.append(
            f"ALTER SEQUENCE dbo.{qident(seq_name)} OWNED BY dbo.{qident(col['table_name'])}.{qident(col['column_name'])};"
        )
        lines.append(
            f"ALTER TABLE ONLY dbo.{qident(col['table_name'])} ALTER COLUMN {qident(col['column_name'])} SET DEFAULT nextval('dbo.{qident(seq_name)}'::regclass);"
        )
        lines.append("")

    for table_name in table_order:
        for row in constraints_by_table.get(table_name, []):
            cols = ", ".join(qident(name) for name in split_columns(row["key_columns"]))
            if row["constraint_type"] == "PRIMARY_KEY_CONSTRAINT":
                kind = "PRIMARY KEY"
            elif row["constraint_type"] == "UNIQUE_CONSTRAINT":
                kind = "UNIQUE"
            else:
                raise ValueError(f"Unsupported constraint type: {row['constraint_type']}")
            lines.append(
                f"ALTER TABLE ONLY dbo.{qident(table_name)} ADD CONSTRAINT {qident(row['constraint_name'])} {kind} ({cols});"
            )
        if constraints_by_table.get(table_name):
            lines.append("")

    for fk_name in fk_order:
        group = fk_groups[fk_name]
        head = group[0]
        parent_columns = ", ".join(qident(row["parent_column"]) for row in group)
        referenced_columns = ", ".join(qident(row["referenced_column"]) for row in group)
        lines.append(
            f"ALTER TABLE ONLY dbo.{qident(head['parent_table'])} ADD CONSTRAINT {qident(fk_name)} "
            f"FOREIGN KEY ({parent_columns}) REFERENCES dbo.{qident(head['referenced_table'])} ({referenced_columns}) "
            f"ON DELETE {map_action(head['delete_action'])} ON UPDATE {map_action(head['update_action'])};"
        )
    lines.append("")

    standalone_indexes = []
    for row in indexes:
        if row["schema_name"] != "dbo":
            continue
        if row["is_primary_key"] == "0" and row["is_unique_constraint"] == "0":
            standalone_indexes.append(row)

    if standalone_indexes:
        grouped_indexes: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        for row in standalone_indexes:
            grouped_indexes[(row["table_name"], row["index_name"])].append(row)
        for (table_name, index_name), group in grouped_indexes.items():
            group.sort(key=lambda row: row["key_columns"])
            key_columns = group[0]["key_columns"]
            included = [row["included_columns"] for row in group if row["included_columns"] != "NULL"]
            create = "CREATE UNIQUE INDEX" if group[0]["is_unique"] == "1" else "CREATE INDEX"
            line = (
                f"{create} {qident(index_name)} ON dbo.{qident(table_name)} "
                f"USING btree ({', '.join(qident(c) for c in split_columns(key_columns))})"
            )
            if included:
                line += f" INCLUDE ({', '.join(qident(c) for c in included)})"
            line += ";"
            lines.append(line)
        lines.append("")

    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- Source SQL Server collation inventory:")
    for collation, count in sorted(collations.items()):
        lines.append(f"--   {collation}: {count} columns")
    lines.append("-- SQL Server clustered index semantics are not portable 1:1 to PostgreSQL heap tables.")
    lines.append("-- SQL Server views, procedures and functions are not emitted here; see the markdown report for the exact inventory.")

    OUTPUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")

    module_counts = Counter(row["type_desc"] for row in modules)
    report_lines = [
        "# PostgreSQL Exact Mirror Status",
        "",
        "## What This Artifact Does",
        "",
        "- Generates a PostgreSQL DDL mirror from the SQL Server metadata CSV exports.",
        "- Preserves exact table names, column names, nullability, primary keys, unique constraints and foreign keys.",
        "- Recreates SQL Server identity columns as PostgreSQL sequences with column defaults.",
        "- Replays SQL Server default values when they are portable.",
        "",
        "## Generated Deliverable",
        "",
        f"- SQL mirror file: `{OUTPUT_SQL.relative_to(ROOT).as_posix()}`",
        "",
        "## Source Counts Reflected",
        "",
        f"- Tables in `dbo`: `{sum(1 for row in tables if row['schema_name'] == 'dbo')}`",
        f"- Primary key constraints: `{sum(1 for row in constraints if row['constraint_type'] == 'PRIMARY_KEY_CONSTRAINT')}`",
        f"- Unique constraints: `{sum(1 for row in constraints if row['constraint_type'] == 'UNIQUE_CONSTRAINT')}`",
        f"- Foreign keys: `{len(fk_groups)}`",
        f"- Identity columns: `{len(identity_columns)}`",
        f"- Columns with SQL Server collation metadata: `{sum(collations.values())}`",
        f"- Defaults converted automatically: `{sum(1 for row in columns if row['default_definition'] != 'NULL') - len(unsupported_defaults)}`",
        f"- Defaults requiring manual rewrite: `{len(unsupported_defaults)}`",
        "",
        "## Engine-Level Differences That Prevent a Literal 100 Percent Clone",
        "",
        "- SQL Server collation `Modern_Spanish_CI_AS` does not exist as a byte-for-byte equivalent in PostgreSQL. The SQL file keeps the inventory but not a synthetic replacement collation.",
        "- SQL Server clustered indexes do not have a direct PostgreSQL equivalent. Primary keys and unique constraints are recreated, but heap storage layout is different.",
        "- SQL Server programmable objects are written in T-SQL and cannot be copied verbatim into PostgreSQL.",
        "",
        "## Programmable Object Inventory Still Pending Rewrite",
        "",
        f"- Stored procedures: `{module_counts.get('SQL_STORED_PROCEDURE', 0)}`",
        f"- Views: `{module_counts.get('VIEW', 0)}`",
        f"- Scalar functions: `{module_counts.get('SQL_SCALAR_FUNCTION', 0)}`",
        f"- Table-valued functions: `{module_counts.get('SQL_TABLE_VALUED_FUNCTION', 0)}`",
        "",
        "## Exactness Boundary",
        "",
        "- Table structure parity: high and metadata-driven.",
        "- Referential parity: exact according to the exported foreign key metadata.",
        "- Default parity: exact for the exported default shapes present in this database export.",
        "- Procedural parity: not yet migrated.",
        "",
        "## Prisma Boundary",
        "",
        "- Prisma is suitable for the application data model.",
        "- Prisma is not the right source of truth for an engine-level exact mirror because it does not cover SQL Server collations, SQL module bodies or storage-level index semantics.",
    ]

    if unsupported_defaults:
        report_lines.extend(["", "## Defaults Still Requiring Manual Rewrite", ""])
        report_lines.extend([f"- `{item}`" for item in unsupported_defaults])

    OUTPUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_REPORT.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_SQL}")
    print(f"Wrote {OUTPUT_REPORT}")


if __name__ == "__main__":
    main()
