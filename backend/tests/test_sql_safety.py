"""Guard for the SQL convention (#12): values are always bound `?` parameters; only reviewed code
expressions may be formatted into SQL text. A new expression here fails until it is reviewed and
added below with the reason it can't carry user input."""
import ast
import re
from pathlib import Path

SQL = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER BY|GROUP BY|JOIN|FROM|LIMIT|CASE|VALUES)\b")

# expression -> why it's safe
REVIEWED = {
    "w_sql": "common.where(): column names + ? placeholders; bucket names validated by Filters",
    "where_sql": "w_sql or the literal '1=1', plus extra_where",
    "time_expr(f)": "one of two constant CASE expressions, picked by a bool",
    "max_expr(f)": "one of two constant expressions, picked by a bool",
    "_metric(f)": "constant column name picked by Filters.metric (validated enum)",
    "'t' if f.metric == 'time' else 'n'": "constant",
    "'time_s' if f.metric == 'time' else 'cnt'": "constant",
    "order": "constant column name picked by Filters.metric",
    "alias": "table alias from code ('w')",
    "joins": "constant JOIN clauses written in code",
    "extra_where": "constant conditions from code; their values are passed as extra_params",
    "cond": "constant 'w.channel_id = ?' style conditions from code",
    "key_sql": "constant column names from code",
    "cnt": "constant aggregate", "tsum": "constant aggregate", "shorts": "constant aggregate",
    "src": "constant subquery built from the reviewed parts above",
    "int(lim)": "an int",
    "early": "constant FROM/WHERE built from w_sql",
    "ph": "a run of ? placeholders",
    "UNKNOWN": "module constant", "UNKNOWN_SHOW": "module constant", "_BRAND": "module constant",
    "cols": "constant column list", "', '.join(WATCH_COLS)": "store.py: constant column list",
    "', '.join(_ENTRY_COLS)": "constant column list", "', '.join(_SEARCH_COLS)": "constant column list",
    "table": "enrich: constant table name from code", "key_col": "enrich: constant column name from code",
    "done_filter": "one of two constant conditions",
}
PLACEHOLDERS = re.compile(r"^'(,|, )'\.join\('\?' \* .+\)$")      # ','.join('?' * n)


def test_only_reviewed_expressions_in_sql():
    root = Path(__file__).resolve().parents[1]
    unreviewed = []
    for p in sorted(root.rglob("*.py")):
        if "tests" in p.parts:
            continue
        for node in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.JoinedStr):
                continue
            text = "".join(v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str))
            if not SQL.search(text):
                continue
            for v in node.values:
                if isinstance(v, ast.FormattedValue):
                    e = ast.unparse(v.value)
                    if e not in REVIEWED and not PLACEHOLDERS.match(e):
                        unreviewed.append(f"{p.relative_to(root)}:{node.lineno} {{{e}}}")
    assert unreviewed == [], "Review these SQL fragments (bind values with ? instead):\n" + "\n".join(unreviewed)
