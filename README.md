SQL Formatter — Zero Doctrine

Formats SQL stored procedures and queries using a strict, opinionated ruleset

Usage

Open any .sql file in VS Code
Right-click anywhere in the editor
Click "Format SQL (Zero Doctrine)"
Your SQL will be formatted in place

The Zero Doctrine Rules

UPPERCASE keywords and datatypes
dbo. prefix on all table names
Zero-based column numbering (--  0, --  1, ... -- 10)
Aligned column comments
No AS for aliases anywhere — columns use [Alias], tables use [alias]
Every WHERE condition wrapped in ( )
CASE WHEN formatted across multiple lines
Inline subqueries formatted as full queries
Tabs for indentation. Always.
No emotional SQL.

Publisher
Harsh