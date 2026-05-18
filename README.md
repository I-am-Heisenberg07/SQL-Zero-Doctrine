# SQL Formatter — Zero Doctrine

A VS Code extension that formats T-SQL stored procedures and queries using a strict, opinionated ruleset. No compromises.

---

## Installation

Install from the VS Code Marketplace or load the `.vsix` directly via **Extensions → Install from VSIX**.

Activates automatically on `.sql` files (including `tsql`, `mssql`, `sql-ms` language modes).

---

## Usage

### Format entire file
- **Right-click** in the editor → **SQL Zero Doctrine: Format Document**
- Keyboard: `Ctrl+Shift+Alt+F`
- Command Palette: `SQL Zero Doctrine: Format Document`

### Format selection
- Select any SQL text, then **right-click** → **SQL Zero Doctrine: Format Selection**
- Keyboard: `Ctrl+Shift+Alt+G`

Both commands edit the document in place.

---

## The Zero Doctrine Rules

| Rule | Detail |
|------|--------|
| UPPERCASE keywords | All SQL keywords and datatypes are uppercased |
| `dbo.` prefix | All table names get a `dbo.` prefix |
| Zero-based column numbering | SELECT columns are commented `-- 0`, `-- 1`, ..., `-- 10` |
| Aligned column comments | Comment numbers are right-aligned to the widest column |
| No `AS` anywhere | Columns use `[Alias]`, tables use `[alias]` — no AS keyword |
| Parenthesized WHERE conditions | Every individual condition wrapped in `( )` |
| Multi-line CASE WHEN | Each WHEN / THEN / ELSE on its own line |
| Inline subqueries formatted | Subqueries inside SELECT/WHERE are fully formatted recursively |
| Tabs for indentation | Always. No spaces. |
| No emotional SQL | Clean, mechanical, consistent. |

---

## What Gets Formatted

- `SELECT` statements — column alignment, alias extraction, CASE WHEN, window functions
- `FROM` / `JOIN` clauses — JOIN type alignment, subquery expansion
- `WHERE` / `HAVING` — condition grouping with `AND` / `OR`, `NOT IN` lists
- `GROUP BY` / `ORDER BY` — comma-separated, one item per line when long
- `INSERT INTO` / `VALUES` — row-per-line values
- `UPDATE` / `SET` — one assignment per line
- `IF` / `ELSE IF` / `ELSE` — recursive formatting for chained conditions
- `WHILE` loops — body formatted as a full proc body
- `WITH` (CTE) — each CTE on its own block, optional column lists supported
- `CREATE / ALTER / CREATE OR ALTER PROCEDURE` — parameter blocks, proc body
- `DECLARE` / `SET` / `EXEC` — inline statement formatting
- Multi-batch files separated by `GO`

---

## Architecture

```
extension.js        VS Code command registration + document edit
formatter.js        Pure formatting logic (no VS Code dependency)
  ├── tokenize()          Lexer — produces typed token stream
  ├── splitIntoClauses()  Groups tokens into clause objects by keyword
  ├── formatClause()      Dispatches each clause to its formatter
  ├── formatBatch()       Handles a single GO-separated batch
  └── formatSQL()         Entry point — splits batches, joins output
```

`formatter.js` exports a single function: `formatSQL(sql: string): string`

---

## Version

`1.0.0` — Publisher: **Harsh**
