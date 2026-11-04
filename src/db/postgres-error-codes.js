/** PostgreSQL lock_not_available — SET LOCAL lock_timeout exceeded. */
const PG_LOCK_NOT_AVAILABLE = '55P03'

/** PostgreSQL undefined_table — the query names a table that does not exist. */
const PG_UNDEFINED_TABLE = '42P01'

/** PostgreSQL undefined_column — the query names a column that does not exist. */
const PG_UNDEFINED_COLUMN = '42703'

export { PG_LOCK_NOT_AVAILABLE, PG_UNDEFINED_TABLE, PG_UNDEFINED_COLUMN }
