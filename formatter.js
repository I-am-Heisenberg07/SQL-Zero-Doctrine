'use strict';

const T = '\t';

// ════════════════════════════════════════════════════════════════════════════
// KEYWORDS & DATATYPES
// ════════════════════════════════════════════════════════════════════════════

const KEYWORDS = new Set([
	'ADD','ALL','ALTER','AND','ANY','AS','ASC','AUTHORIZATION',
	'BACKUP','BEGIN','BETWEEN','BREAK','BROWSE','BULK','BY',
	'CASCADE','CASE','CHECK','CHECKPOINT','CLOSE','CLUSTERED','COALESCE',
	'COLLATE','COLUMN','COMMIT','COMPUTE','CONSTRAINT','CONTAINS',
	'CONTINUE','CONVERT','CREATE','CROSS','CURRENT','CURSOR',
	'DATABASE','DBCC','DEALLOCATE','DECLARE','DEFAULT','DELETE','DENY',
	'DESC','DISK','DISTINCT','DISTRIBUTED','DROP',
	'ELSE','END','ENCRYPTION','ERRLVL','ESCAPE','EXCEPT','EXEC','EXECUTE','EXISTS','EXIT',
	'FETCH','FILE','FILLFACTOR','FOR','FOREIGN','FROM','FULL','FUNCTION',
	'GOTO','GRANT','GROUP',
	'HAVING','HOLDLOCK',
	'IDENTITY','IF','IN','INDEX','INNER','INSERT','INTERSECT','INTO','IS',
	'JOIN',
	'KEY','KILL',
	'LEFT','LIKE','LOAD',
	'MERGE',
	'NOT','NULL','NULLIF',
	'OF','OFF','ON','OPEN','OPENQUERY','OPENROWSET','OPENXML','OPTION','OR','ORDER','OUTER','OVER',
	'PARTITION','PERCENT','PIVOT','PLAN','PRIMARY','PRINT','PROC','PROCEDURE',
	'RAISERROR','READ','RECOMPILE','REFERENCES','REPLICATION','RESTORE','RETURN','REVOKE','RIGHT','ROLLBACK',
	'SAVE','SCHEMA','SELECT','SET','SHUTDOWN','SOME',
	'TABLE','THEN','TO','TOP','TRAN','TRANSACTION','TRIGGER','TRUNCATE',
	'UNION','UNIQUE','UNPIVOT','UPDATE','USE',
	'VALUES','VIEW',
	'WAITFOR','WHEN','WHERE','WHILE','WITH',
	// window functions
	'ROW_NUMBER','RANK','DENSE_RANK','NTILE','FIRST_VALUE','LAST_VALUE','LAG','LEAD',
	// common functions
	'CAST','ISNULL','IIF','CHOOSE',
	'COUNT','SUM','AVG','MIN','MAX','STDEV','VAR',
	'GETDATE','GETUTCDATE','SYSDATETIME','DATEADD','DATEDIFF','DATENAME','DATEPART','EOMONTH',
	'LEN','SUBSTRING','CHARINDEX','PATINDEX','STUFF','REPLACE',
	'UPPER','LOWER','LTRIM','RTRIM','TRIM','FORMAT','CONCAT','STRING_AGG',
	'ABS','CEILING','FLOOR','ROUND','POWER','SQRT',
	'NEWID','OBJECT_ID','OBJECT_NAME','SCHEMA_NAME',
	'NOLOCK','UPDLOCK','ROWLOCK','TABLOCK','READPAST','READUNCOMMITTED',
	'ROWS','RANGE','PRECEDING','FOLLOWING','ONLY','OFFSET','NEXT',
	'APPLY','OUTPUT',
	'THROW','TRY','CATCH',
	'STRING_SPLIT','OPENJSON',
]);

const DATATYPES = new Set([
	'BIGINT','BINARY','BIT','CHAR','DATE','DATETIME','DATETIME2','DATETIMEOFFSET',
	'DECIMAL','FLOAT','GEOGRAPHY','GEOMETRY','HIERARCHYID','IMAGE','INT','INTEGER',
	'MONEY','NCHAR','NTEXT','NUMERIC','NVARCHAR','REAL','ROWVERSION','SMALLDATETIME',
	'SMALLINT','SMALLMONEY','SQL_VARIANT','TEXT','TIME','TIMESTAMP','TINYINT',
	'UNIQUEIDENTIFIER','VARBINARY','VARCHAR','XML','TABLE','CURSOR',
]);

// ════════════════════════════════════════════════════════════════════════════
// TOKENIZER
// ════════════════════════════════════════════════════════════════════════════

function tokenize(sql) {
	const tokens = [];
	let i = 0;
	const n = sql.length;

	while (i < n) {
		if (/\s/.test(sql[i])) { i++; continue; }

		// -- line comment
		if (sql[i] === '-' && sql[i + 1] === '-') {
			let j = i;
			while (j < n && sql[j] !== '\n') j++;
			tokens.push({ t: 'COMMENT', v: sql.slice(i, j) });
			i = j;
			continue;
		}

		// /* block comment */
		if (sql[i] === '/' && sql[i + 1] === '*') {
			let j = i + 2;
			while (j < n - 1 && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
			tokens.push({ t: 'COMMENT', v: sql.slice(i, j + 2) });
			i = j + 2;
			continue;
		}

		// N'string' or 'string'
		if (sql[i] === "'" || (sql[i] === 'N' && sql[i + 1] === "'")) {
			const pfx = sql[i] === 'N' ? (i++, 'N') : '';
			let j = i + 1;
			while (j < n) {
				if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
				if (sql[j] === "'") { j++; break; }
				j++;
			}
			tokens.push({ t: 'STR', v: pfx + sql.slice(i, j) });
			i = j;
			continue;
		}

		// [bracketed identifier]
		if (sql[i] === '[') {
			let j = i + 1;
			while (j < n && sql[j] !== ']') j++;
			tokens.push({ t: 'BID', v: sql.slice(i, j + 1) });
			i = j + 1;
			continue;
		}

		// @variable
		if (sql[i] === '@') {
			let j = i + 1;
			while (j < n && /\w/.test(sql[j])) j++;
			tokens.push({ t: 'VAR', v: sql.slice(i, j) });
			i = j;
			continue;
		}

		// number
		if (/\d/.test(sql[i])) {
			let j = i;
			while (j < n && /[\d.]/.test(sql[j])) j++;
			tokens.push({ t: 'NUM', v: sql.slice(i, j) });
			i = j;
			continue;
		}

		// identifier or keyword
		if (/[a-zA-Z_#$]/.test(sql[i])) {
			let j = i;
			while (j < n && /[\w#$]/.test(sql[j])) j++;
			const raw = sql.slice(i, j);
			const up = raw.toUpperCase();
			if (DATATYPES.has(up)) {
				tokens.push({ t: 'DT', v: up });
			} else if (KEYWORDS.has(up)) {
				tokens.push({ t: 'KW', v: up });
			} else {
				tokens.push({ t: 'ID', v: raw });
			}
			i = j;
			continue;
		}

		// two-char operators
		const two = sql.slice(i, i + 2);
		if (['<>', '<=', '>=', '!=', '+=', '-=', '*=', '/='].includes(two)) {
			tokens.push({ t: 'OP', v: two });
			i += 2;
			continue;
		}

		// single-char
		const ch = sql[i];
		const map = { ',': 'COMMA', '(': 'LP', ')': 'RP', ';': 'SEMI', '.': 'DOT', '*': 'STAR' };
		tokens.push({ t: map[ch] || 'OP', v: ch });
		i++;
	}

	return tokens;
}

// ════════════════════════════════════════════════════════════════════════════
// TOKEN UTILITIES
// ════════════════════════════════════════════════════════════════════════════

// Tokens → human-readable string with smart spacing
function tokStr(tokens) {
	let out = '';
	for (let i = 0; i < tokens.length; i++) {
		const cur = tokens[i];
		const prev = tokens[i - 1];
		if (i === 0) { out += cur.v; continue; }
		if (cur.t === 'DOT' || (prev && prev.t === 'DOT')) { out += cur.v; continue; }
		if (cur.t === 'RP') { out += cur.v; continue; }
		if (prev && prev.t === 'LP') { out += cur.v; continue; }
		if (cur.t === 'COMMA') { out += cur.v; continue; }
		if (prev && prev.t === 'COMMA') { out += ' ' + cur.v; continue; }
		out += ' ' + cur.v;
	}
	return out;
}

// Split token array at top-level commas (depth 0)
function splitAtCommas(tokens) {
	const groups = [];
	let cur = [];
	let depth = 0;
	for (const tok of tokens) {
		if (tok.t === 'LP') { depth++; cur.push(tok); }
		else if (tok.t === 'RP') { depth--; cur.push(tok); }
		else if (tok.t === 'COMMA' && depth === 0) { groups.push(cur); cur = []; }
		else { cur.push(tok); }
	}
	if (cur.length) groups.push(cur);
	return groups;
}

// Split at top-level occurrences of keywords in kwSet
function splitAtTopKws(tokens, kwSet) {
	const groups = [];
	let cur = { kw: null, tokens: [] };
	let depth = 0;
	for (const tok of tokens) {
		if (tok.t === 'LP') { depth++; cur.tokens.push(tok); }
		else if (tok.t === 'RP') { depth--; cur.tokens.push(tok); }
		else if (depth === 0 && tok.t === 'KW' && kwSet.has(tok.v)) {
			groups.push(cur);
			cur = { kw: tok.v, tokens: [] };
		} else {
			cur.tokens.push(tok);
		}
	}
	groups.push(cur);
	return groups;
}

// If tokens are wrapped in a single matching () pair, strip them
function stripOuterParens(tokens) {
	if (tokens.length < 2 || tokens[0]?.t !== 'LP') return tokens;
	let depth = 0;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].t === 'LP') depth++;
		if (tokens[i].t === 'RP') { depth--; if (depth === 0 && i < tokens.length - 1) return tokens; }
	}
	return tokens.slice(1, -1);
}

// ════════════════════════════════════════════════════════════════════════════
// CLAUSE SPLITTER  — breaks a flat token array into named clause blocks
// ════════════════════════════════════════════════════════════════════════════

const TOP_CLAUSE_KWS = new Set([
	'SELECT','FROM','WHERE','ORDER','GROUP','HAVING',
	'UNION','INTERSECT','EXCEPT',
	'INSERT','UPDATE','DELETE',
	'CREATE','ALTER','DROP',
	'BEGIN','END','DECLARE','SET','IF','ELSE','WHILE',
	'RETURN','EXEC','EXECUTE','PRINT','RAISERROR','THROW',
]);

function splitIntoClauses(tokens) {
	const clauses = [];
	let cur = null;
	let depth = 0;

	for (const tok of tokens) {
		if (tok.t === 'LP') depth++;
		else if (tok.t === 'RP') depth--;

		if (depth === 0 && tok.t === 'KW' && TOP_CLAUSE_KWS.has(tok.v)) {
			if (cur) clauses.push(cur);
			cur = { type: tok.v, tokens: [] };
		} else if (cur) {
			cur.tokens.push(tok);
		} else {
			cur = { type: '_', tokens: [tok] };
		}
	}
	if (cur) clauses.push(cur);
	return clauses;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 3 + 8 + 9 + 10 — SELECT CLAUSE
// ════════════════════════════════════════════════════════════════════════════

function formatSelectClause(clauseTokens) {
	let i = 0;
	let selectPrefix = 'SELECT' + T;

	// TOP N
	if (clauseTokens[i]?.t === 'KW' && clauseTokens[i]?.v === 'TOP') {
		i++;
		const n = clauseTokens[i++]?.v || '';
		selectPrefix += 'TOP ' + n + ' ';
	}

	// DISTINCT
	if (clauseTokens[i]?.t === 'KW' && clauseTokens[i]?.v === 'DISTINCT') {
		i++;
		selectPrefix += 'DISTINCT ';
	}

	const remaining = clauseTokens.slice(i);

	// SELECT *
	if (remaining.length === 1 && remaining[0].t === 'STAR') {
		return 'SELECT' + T + '*';
	}

	const colGroups = splitAtCommas(remaining);
	if (!colGroups.length) return 'SELECT' + T + '*';

	// Parse each column
	const parsed = colGroups.map((toks, idx) => parseSelectColumn(toks, idx));

	// Determine alignment column (Rule 8) — longest normal line
	const normalLengths = parsed.map((col, idx) => {
		if (col.isMultiLine || col.isLong) return 0;
		const linePrefix = idx === 0 ? selectPrefix : T + T + ', ';
		return (linePrefix + col.mainLine).length;
	});
	const alignAt = Math.max(...normalLengths);

	// Emit
	const lines = [];
	for (let idx = 0; idx < parsed.length; idx++) {
		const col = parsed[idx];
		const colNum = idx <= 9 ? `--  ${idx}` : `-- ${idx}`;
		const linePrefix = idx === 0 ? selectPrefix : T + T + ', ';

		if (col.isMultiLine) {
			// All lines except the last (alias line) are emitted as-is
			for (let li = 0; li < col.lines.length - 1; li++) {
				lines.push(col.lines[li]);
			}
			// Alias line gets the comment
			lines.push(col.lines[col.lines.length - 1] + '  ' + colNum);
		} else {
			const full = linePrefix + col.mainLine;
			if (col.isLong) {
				lines.push(full + '  ' + colNum);
			} else {
				const pad = ' '.repeat(Math.max(1, alignAt - full.length + 1));
				lines.push(full + pad + colNum);
			}
		}
	}

	return lines.join('\n');
}

function parseSelectColumn(tokens, idx) {
	// CASE expression: starts with LP then CASE (or just CASE at depth 0)
	const hasCaseAtTop = tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'CASE';
	if (hasCaseAtTop) return formatCaseColumn(tokens, idx);

	// Inline subquery: LP then SELECT
	if (tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'SELECT') {
		return formatSubqueryColumn(tokens, idx);
	}

	// Window function (contains OVER)
	const hasOver = tokens.some(t => t.t === 'KW' && t.v === 'OVER');

	// Extract alias: last BID that isn't immediately after DOT or LP
	const { expr, alias } = extractAlias(tokens);
	const exprStr = tokStr(expr);
	const mainLine = alias ? exprStr + ' ' + alias : exprStr;

	const longKws = new Set(['CASE','CAST','CONVERT','ISNULL','COALESCE','OVER',
		'ROW_NUMBER','RANK','DENSE_RANK','FIRST_VALUE','LAST_VALUE','LAG','LEAD']);
	const isLong = hasOver || mainLine.length > 80 ||
		tokens.some(t => longKws.has(t.v));

	return { isMultiLine: false, isLong, mainLine };
}

function extractAlias(tokens) {
	// Strip AS keyword if present (Rule 11)
	const asIdx = tokens.findLastIndex(t => t.t === 'KW' && t.v === 'AS');
	if (asIdx >= 0 && asIdx === tokens.length - 2) {
		const aliasToken = tokens[asIdx + 1];
		const alias = aliasToken.t === 'BID' ? aliasToken.v : `[${aliasToken.v}]`;
		return { expr: tokens.slice(0, asIdx), alias };
	}

	// Last token is [bracketed] and previous token is not a DOT or LP
	const last = tokens[tokens.length - 1];
	const prev = tokens[tokens.length - 2];
	if (last?.t === 'BID' && prev && prev.t !== 'DOT' && prev.t !== 'LP') {
		return { expr: tokens.slice(0, -1), alias: last.v };
	}

	return { expr: tokens, alias: null };
}

function formatCaseColumn(tokens, idx) {
	// Find matching outer parens
	let depth = 0, parenEnd = -1;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].t === 'LP') { depth++; }
		if (tokens[i].t === 'RP') { depth--; if (depth === 0) { parenEnd = i; break; } }
	}

	const caseTokens = tokens.slice(1, parenEnd); // strip outer ( )
	const afterParen = tokens.slice(parenEnd + 1);
	let alias = null;
	if (afterParen.length && afterParen[afterParen.length - 1]?.t === 'BID') {
		alias = afterParen[afterParen.length - 1].v;
	}

	const base = T + T;
	const lines = [];
	lines.push(base + (idx === 0 ? '  (' : ', ('));  // first col has no leading comma

	lines.push(...emitCaseLines(caseTokens, base + T));
	lines.push(base + ') ' + (alias || ''));

	return { isMultiLine: true, isLong: false, lines };
}

function emitCaseLines(tokens, indent) {
	const lines = [];
	let i = 0;
	if (tokens[i]?.v === 'CASE') i++;
	lines.push(indent + 'CASE');

	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.v === 'WHEN') {
			i++;
			const whenToks = [];
			while (i < tokens.length && tokens[i].v !== 'THEN') whenToks.push(tokens[i++]);
			lines.push(indent + T + 'WHEN ' + tokStr(whenToks));
			if (tokens[i]?.v === 'THEN') i++;
			const thenToks = [];
			while (i < tokens.length && !['WHEN', 'ELSE', 'END'].includes(tokens[i].v)) {
				thenToks.push(tokens[i++]);
			}
			lines.push(indent + T + T + 'THEN ' + tokStr(thenToks));
		} else if (tok.v === 'ELSE') {
			i++;
			const elseToks = [];
			while (i < tokens.length && tokens[i].v !== 'END') elseToks.push(tokens[i++]);
			lines.push(indent + T + 'ELSE ' + tokStr(elseToks));
		} else if (tok.v === 'END') {
			i++;
		} else {
			i++;
		}
	}

	lines.push(indent + 'END');
	return lines;
}

function formatSubqueryColumn(tokens, idx) {
	let depth = 0, parenEnd = -1;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].t === 'LP') depth++;
		if (tokens[i].t === 'RP') { depth--; if (depth === 0) { parenEnd = i; break; } }
	}

	const innerTokens = tokens.slice(1, parenEnd);
	const afterParen = tokens.slice(parenEnd + 1);
	let alias = null;
	if (afterParen.length && afterParen[afterParen.length - 1]?.t === 'BID') {
		alias = afterParen[afterParen.length - 1].v;
	}

	const base = T + T;
	const innerFormatted = formatSelectStatement(innerTokens);
	const lines = [];
	lines.push(base + (idx === 0 ? '  (' : ', ('));
	innerFormatted.split('\n').forEach(l => lines.push(base + T + l));
	lines.push(base + ') ' + (alias || ''));

	return { isMultiLine: true, isLong: false, lines };
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 4 — FROM + JOIN
// ════════════════════════════════════════════════════════════════════════════

const JOIN_START_KWS = new Set(['JOIN','INNER','LEFT','RIGHT','FULL','CROSS','OUTER','APPLY']);

function formatFromClause(clauseTokens) {
	const blocks = splitFromBlocks(clauseTokens);
	if (!blocks.length) return 'FROM';

	const lines = [];
	const [main, ...joins] = blocks;
	lines.push('FROM' + T + formatTableRef(main.tokens));

	for (const block of joins) {
		const onIdx = block.tokens.findIndex(t => t.t === 'KW' && t.v === 'ON');
		const tableToks = onIdx >= 0 ? block.tokens.slice(0, onIdx) : block.tokens;
		const onToks = onIdx >= 0 ? block.tokens.slice(onIdx + 1) : [];

		lines.push(T + T + block.joinType + ' ' + formatTableRef(tableToks));

		if (onToks.length) {
			const conditions = splitAtTopKws(onToks, new Set(['AND', 'OR']));
			conditions.forEach(({ kw, tokens: ct }, ci) => {
				if (ci === 0) {
					lines.push(T + T + T + T + 'ON' + T + tokStr(ct));
				} else {
					lines.push(T + T + T + kw + T + tokStr(ct));
				}
			});
		}
	}

	return lines.join('\n');
}

function splitFromBlocks(tokens) {
	const blocks = [];
	let cur = { joinType: null, tokens: [] };
	let depth = 0, i = 0;

	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.t === 'LP') { depth++; cur.tokens.push(tok); i++; continue; }
		if (tok.t === 'RP') { depth--; cur.tokens.push(tok); i++; continue; }

		if (depth === 0 && tok.t === 'KW' && JOIN_START_KWS.has(tok.v)) {
			blocks.push(cur);
			let jt = tok.v;
			i++;
			while (i < tokens.length && tokens[i].t === 'KW' &&
				(JOIN_START_KWS.has(tokens[i].v) || tokens[i].v === 'APPLY')) {
				jt += ' ' + tokens[i].v;
				i++;
			}
			cur = { joinType: jt, tokens: [] };
			continue;
		}
		cur.tokens.push(tok);
		i++;
	}
	blocks.push(cur);
	return blocks;
}

function formatTableRef(tokens) {
	if (!tokens.length) return '';

	// Derived table: LP SELECT ... RP [alias]
	if (tokens[0]?.t === 'LP') {
		let depth = 0, parenEnd = -1;
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i].t === 'LP') depth++;
			if (tokens[i].t === 'RP') { depth--; if (depth === 0) { parenEnd = i; break; } }
		}
		const inner = tokens.slice(1, parenEnd);
		const after = tokens.slice(parenEnd + 1);
		const alias = after.length && after[after.length - 1]?.t === 'BID'
			? after[after.length - 1].v : '';
		const innerFmt = formatSelectStatement(inner);
		return '(\n' + innerFmt.split('\n').map(l => T + T + T + T + l).join('\n') +
			'\n' + T + T + ') ' + alias;
	}

	const { expr, alias } = extractAlias(tokens);
	let tableStr = tokStr(expr);

	// Add dbo. prefix to bare table names (no schema prefix, not a function call, not #temp/@var)
	const noSchema = !tableStr.includes('.');
	const notSpecial = !/^[#@]/.test(tableStr);
	const notFn = !expr.some(t => t.t === 'LP');
	if (noSchema && notSpecial && notFn) tableStr = 'dbo.' + tableStr;

	return alias ? tableStr + ' ' + alias : tableStr;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 5 — WHERE CLAUSE
// ════════════════════════════════════════════════════════════════════════════

function formatWhereClause(clauseTokens) {
	const groups = splitWhereGroups(clauseTokens);
	const lines = [];

	groups.forEach(({ kw, tokens: gt }, i) => {
		if (i === 0) {
			lines.push('WHERE' + T + '(');
		} else {
			lines.push(T + T + (kw || 'AND'));
			lines.push(T + T + '(');
		}
		formatConditionGroup(gt).forEach(l => lines.push(T + T + T + l));
		lines.push(T + T + ')');
	});

	return lines.join('\n');
}

function splitWhereGroups(tokens) {
	const segments = splitAtTopKws(tokens, new Set(['AND', 'OR']));
	return segments.filter(s => s.tokens.length).map(s => ({
		kw: s.kw,
		tokens: stripOuterParens(s.tokens),
	}));
}

function formatConditionGroup(tokens) {
	if (!tokens.length) return [];

	// EXISTS / NOT EXISTS
	const firstKw = tokens[0]?.v;
	if (firstKw === 'EXISTS' || (firstKw === 'NOT' && tokens[1]?.v === 'EXISTS')) {
		const prefix = firstKw === 'NOT' ? 'NOT EXISTS' : 'EXISTS';
		const skip = firstKw === 'NOT' ? 3 : 2; // skip EXISTS ( ... start paren
		const inner = tokens.slice(skip, tokens.length - 1);
		return [prefix, '(', ...formatSelectStatement(inner).split('\n').map(l => T + l), ')'];
	}

	// IN with long list (4+ items)
	const inIdx = tokens.findIndex(t => t.t === 'KW' && t.v === 'IN');
	if (inIdx >= 0 && tokens[inIdx + 1]?.t === 'LP') {
		const colStr = tokStr(tokens.slice(0, inIdx));
		const listEnd = findMatchingParen(tokens, inIdx + 1);
		const listToks = tokens.slice(inIdx + 2, listEnd);

		// Check for subquery inside IN
		if (listToks[0]?.t === 'KW' && listToks[0]?.v === 'SELECT') {
			const inner = formatSelectStatement(listToks);
			return [colStr + ' IN (', ...inner.split('\n').map(l => T + l), ')'];
		}

		const items = splitAtCommas(listToks);
		if (items.length >= 4) {
			const out = [colStr + ' IN ('];
			items.forEach((it, ii) =>
				out.push((ii === 0 ? T + T + T : T + T + T + ', ') + tokStr(it)));
			out.push(T + T + ')');
			return out;
		}
	}

	return [tokStr(tokens)];
}

function findMatchingParen(tokens, openIdx) {
	let depth = 0;
	for (let i = openIdx; i < tokens.length; i++) {
		if (tokens[i].t === 'LP') depth++;
		if (tokens[i].t === 'RP') { depth--; if (depth === 0) return i; }
	}
	return tokens.length - 1;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 6 — ORDER BY / GROUP BY / HAVING / PAGINATION
// ════════════════════════════════════════════════════════════════════════════

function formatOrderByClause(clauseTokens) {
	// Strip leading BY
	let toks = clauseTokens[0]?.v === 'BY' ? clauseTokens.slice(1) : clauseTokens;

	// Split off OFFSET ... FETCH ...
	const offsetIdx = toks.findIndex(t => t.t === 'KW' && t.v === 'OFFSET');
	const pagToks = offsetIdx >= 0 ? toks.slice(offsetIdx) : [];
	toks = offsetIdx >= 0 ? toks.slice(0, offsetIdx) : toks;

	const cols = splitAtCommas(toks);
	const lines = ['ORDER BY'];
	cols.forEach((ct, i) => lines.push((i === 0 ? T + T : T + T + ', ') + tokStr(ct)));

	if (pagToks.length) {
		const fetchIdx = pagToks.findIndex(t => t.v === 'FETCH');
		if (fetchIdx >= 0) {
			lines.push(T + T + tokStr(pagToks.slice(0, fetchIdx)));
			lines.push(T + T + tokStr(pagToks.slice(fetchIdx)));
		} else {
			lines.push(T + T + tokStr(pagToks));
		}
	}

	return lines.join('\n');
}

function formatGroupByClause(clauseTokens) {
	const toks = clauseTokens[0]?.v === 'BY' ? clauseTokens.slice(1) : clauseTokens;
	const cols = splitAtCommas(toks);
	const lines = ['GROUP BY'];
	cols.forEach((ct, i) => lines.push((i === 0 ? T + T : T + T + ', ') + tokStr(ct)));
	return lines.join('\n');
}

function formatHavingClause(clauseTokens) {
	const groups = splitWhereGroups(clauseTokens);
	const lines = ['HAVING'];

	groups.forEach(({ kw, tokens: gt }, i) => {
		if (i > 0) {
			lines.push(T + T + (kw || 'AND'));
		}
		lines.push(T + T + '(');
		formatConditionGroup(gt).forEach(l => lines.push(T + T + T + l));
		lines.push(T + T + ')');
	});

	return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 2 — STORED PROCEDURE
// ════════════════════════════════════════════════════════════════════════════

function formatProcStatement(tokens) {
	let i = 0;
	const action = tokens[i++]?.v || 'ALTER'; // CREATE or ALTER

	// PROCEDURE / PROC keyword
	if (tokens[i]?.t === 'KW' && (tokens[i]?.v === 'PROCEDURE' || tokens[i]?.v === 'PROC')) i++;

	// Proc name (schema.Name)
	let procName = '';
	while (i < tokens.length && (tokens[i].t === 'ID' || tokens[i].t === 'BID' || tokens[i].t === 'DOT')) {
		procName += tokens[i].v;
		i++;
	}
	if (!procName.includes('.')) procName = 'dbo.' + procName;

	const lines = [`${action} PROCEDURE ${procName}`];

	// Parameters — up to WITH or AS
	const params = [];
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.t === 'KW' && (tok.v === 'WITH' || tok.v === 'AS')) break;
		if (tok.t === 'VAR') {
			const param = parseProcParam(tokens, i);
			params.push(param);
			i = param.nextIdx;
			if (tokens[i]?.t === 'COMMA') i++;
			continue;
		}
		i++;
	}

	params.forEach((p, pi) => {
		const parts = [p.name + ' ' + p.datatype];
		if (p.defaultVal !== null) parts.push('= ' + p.defaultVal);
		if (p.isOutput) parts.push('OUTPUT');
		lines.push((pi === 0 ? '    ' : T + ', ') + parts.join(' '));
	});

	// WITH RECOMPILE / ENCRYPTION
	if (tokens[i]?.v === 'WITH') {
		i++;
		const opts = [];
		while (i < tokens.length && tokens[i]?.t !== 'KW' || tokens[i]?.v === 'RECOMPILE' || tokens[i]?.v === 'ENCRYPTION') {
			if (tokens[i]?.v === 'RECOMPILE') { opts.push('RECOMPILE'); i++; break; }
			if (tokens[i]?.v === 'ENCRYPTION') { opts.push('ENCRYPTION'); i++; break; }
			break;
		}
		if (opts.length) lines.push('WITH ' + opts.join(', '));
	}

	lines.push('AS');
	lines.push('BEGIN');
	lines.push('');

	// Skip to AS and BEGIN in token stream
	while (i < tokens.length && tokens[i]?.v !== 'AS') i++;
	i++; // skip AS
	if (tokens[i]?.v === 'BEGIN') i++; // skip BEGIN

	// Collect body tokens (stop at matching END)
	const bodyToks = [];
	let depth = 1;
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.v === 'BEGIN') depth++;
		if (tok.v === 'END') { depth--; if (depth === 0) break; }
		bodyToks.push(tok);
		i++;
	}

	formatProcBody(bodyToks).forEach(l => lines.push(l));
	lines.push('');
	lines.push('END');

	return lines.join('\n');
}

function parseProcParam(tokens, startIdx) {
	let i = startIdx;
	const name = tokens[i++]?.v || '';

	let datatype = '';
	if (tokens[i]?.t === 'DT' || (tokens[i]?.t === 'KW' && DATATYPES.has(tokens[i]?.v))) {
		datatype = tokens[i++].v;
		if (tokens[i]?.t === 'LP') {
			datatype += '(';
			i++;
			while (i < tokens.length && tokens[i]?.t !== 'RP') datatype += tokens[i++].v;
			datatype += ')';
			i++; // skip RP
		}
	}

	let defaultVal = null;
	let isOutput = false;

	if (tokens[i]?.t === 'OP' && tokens[i]?.v === '=') {
		i++;
		const defToks = [];
		while (i < tokens.length) {
			const t = tokens[i];
			if (t.t === 'COMMA' || t.t === 'KW' && ['OUTPUT','WITH','AS'].includes(t.v)) break;
			defToks.push(t);
			i++;
		}
		defaultVal = tokStr(defToks);
	}

	if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'OUTPUT') { isOutput = true; i++; }

	return { name, datatype, defaultVal, isOutput, nextIdx: i };
}

function formatProcBody(tokens) {
	const clauses = splitIntoClauses(tokens);
	const lines = [];

	// Group DECLAREs first, then SETs, then other statements (Rule 2)
	const declares = clauses.filter(c => c.type === 'DECLARE');
	const sets = clauses.filter(c => c.type === 'SET');
	const others = clauses.filter(c => c.type !== 'DECLARE' && c.type !== 'SET');

	declares.forEach(d => lines.push(T + 'DECLARE ' + tokStr(d.tokens)));
	if (declares.length) lines.push('');
	sets.forEach(s => lines.push(T + 'SET ' + tokStr(s.tokens)));
	if (sets.length) lines.push('');
	others.forEach(c => {
		const fmt = formatClause(c);
		fmt.split('\n').forEach(l => lines.push(T + l));
		lines.push('');
	});

	return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// CLAUSE DISPATCHER
// ════════════════════════════════════════════════════════════════════════════

function formatClause(clause) {
	switch (clause.type) {
		case 'SELECT':  return formatSelectClause(clause.tokens);
		case 'FROM':    return formatFromClause(clause.tokens);
		case 'WHERE':   return formatWhereClause(clause.tokens);
		case 'ORDER':   return formatOrderByClause(clause.tokens);
		case 'GROUP':   return formatGroupByClause(clause.tokens);
		case 'HAVING':  return formatHavingClause(clause.tokens);
		default:        return clause.type + (clause.tokens.length ? ' ' + tokStr(clause.tokens) : '');
	}
}

// ════════════════════════════════════════════════════════════════════════════
// SELECT STATEMENT  (recursive entry used by subquery formatters)
// ════════════════════════════════════════════════════════════════════════════

function formatSelectStatement(tokens) {
	const clauses = splitIntoClauses(tokens);
	return clauses.map(formatClause).join('\n\n');
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

function formatSQL(sql) {
	try {
		const tokens = tokenize(sql);
		if (!tokens.length) return sql;

		const firstKw = tokens.find(t => t.t === 'KW');
		if (!firstKw) return sql;

		// Stored procedure
		if (firstKw.v === 'CREATE' || firstKw.v === 'ALTER') {
			const firstIdx = tokens.indexOf(firstKw);
			const nextKw = tokens.slice(firstIdx + 1).find(t => t.t === 'KW');
			if (nextKw?.v === 'PROCEDURE' || nextKw?.v === 'PROC') {
				return formatProcStatement(tokens);
			}
		}

		return formatSelectStatement(tokens);
	} catch (err) {
		// Never crash the extension — return original on any error
		console.error('[SQL Zero Doctrine] formatter error:', err);
		return sql;
	}
}

module.exports = { formatSQL };
