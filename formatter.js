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
	'ROW_NUMBER','RANK','DENSE_RANK','NTILE','FIRST_VALUE','LAST_VALUE','LAG','LEAD',
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

// TVFs that must NOT receive dbo. prefix
const TVF_NAMES = new Set([
	'STRING_SPLIT','OPENJSON','OPENROWSET','OPENQUERY','OPENXML',
	'FREETEXTTABLE','CONTAINSTABLE','CHANGETABLE',
]);

// ════════════════════════════════════════════════════════════════════════════
// TOKENIZER
// ════════════════════════════════════════════════════════════════════════════

function tokenize(sql) {
	const tokens = [];
	let i = 0;
	const n = sql.length;

	while (i < n) {
		// Newlines — preserve so inline comments don't bleed across lines
		if (sql[i] === '\n') { tokens.push({ t: 'NL', v: '\n' }); i++; continue; }
		if (/[ \t\r]/.test(sql[i])) { i++; continue; }

		// -- line comment: keep as COMMENT token including its text
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

		// number — merge preceding unary minus when context is clearly unary
		if (/\d/.test(sql[i])) {
			let j = i;
			while (j < n && /[\d.]/.test(sql[j])) j++;
			const last = tokens[tokens.length - 1];
			if (last && last.t === 'OP' && last.v === '-') {
				const prev2 = tokens[tokens.length - 2];
				const isUnary = !prev2 || prev2.t === 'OP' || prev2.t === 'KW' || prev2.t === 'COMMA';
				if (isUnary) {
					tokens.pop();
					tokens.push({ t: 'NUM', v: '-' + sql.slice(i, j) });
					i = j; continue;
				}
			}
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
			if (up === 'GO') {
				// GO is a batch separator — emit as its own passthrough token
				tokens.push({ t: 'GO', v: 'GO' });
			} else if (DATATYPES.has(up)) {
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

function tokStr(tokens) {
	let out = '';
	for (let i = 0; i < tokens.length; i++) {
		const cur = tokens[i];
		const prev = tokens[i - 1];
		if (!cur || cur.t === 'NL') continue;
		if (i === 0) { out += cur.v; continue; }
		if (cur.t === 'COMMENT') { out += ' ' + cur.v; continue; }
		if (cur.t === 'DOT' || (prev && prev.t === 'DOT')) { out += cur.v; continue; }
		if (cur.t === 'RP') { out += cur.v; continue; }
		if (prev && prev.t === 'LP') { out += cur.v; continue; }
		if (cur.t === 'COMMA') { out += cur.v; continue; }
		if (prev && prev.t === 'COMMA') { out += ' ' + cur.v; continue; }
		// Space before ( always — expected output shows CAST (x), DATEDIFF (x, y), etc.
		out += ' ' + cur.v;
	}
	return out;
}

// Rule 17: col 0-9 → "--  N", col 10+ → "-- N"
function colComment(idx) {
	return idx < 10 ? `--  ${idx}` : `-- ${idx}`;
}

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

function splitAtTopKws(tokens, kwSet) {
	const groups = [];
	let cur = { kw: null, tokens: [] };
	let depth = 0;
	let caseD = 0;
	for (const tok of tokens) {
		if (tok.t === 'LP') depth++;
		else if (tok.t === 'RP') depth--;
		if (tok.t === 'KW' && tok.v === 'CASE') caseD++;
		else if (tok.t === 'KW' && tok.v === 'END' && caseD > 0) caseD--;

		if (depth === 0 && caseD === 0 && tok.t === 'KW' && kwSet.has(tok.v)) {
			groups.push(cur);
			cur = { kw: tok.v, tokens: [] };
		} else {
			cur.tokens.push(tok);
		}
	}
	groups.push(cur);
	return groups;
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
// CLAUSE SPLITTER
// ════════════════════════════════════════════════════════════════════════════

// NOTE: END and ELSE intentionally excluded — handled by depth tracking
// NOTE: BEGIN excluded — stays inside its owning clause (IF/WHILE body)
const TOP_CLAUSE_KWS = new Set([
	'SELECT','FROM','WHERE','ORDER','GROUP','HAVING',
	'UNION','INTERSECT','EXCEPT',
	'INSERT','UPDATE','DELETE','MERGE',
	'CREATE','ALTER','DROP',
	'DECLARE','SET','IF','WHILE',
	'RETURN','EXEC','EXECUTE','PRINT','RAISERROR','THROW',
]);

function splitIntoClauses(tokens) {
	const clauses = [];
	let cur = null;
	let parenDepth = 0;
	let caseDepth = 0;
	let beginDepth = 0;  // tracks BEGIN...END so IF body stays inside IF clause

	for (const tok of tokens) {
		if (tok.t === 'NL' || tok.t === 'GO') continue; // skip batch separators
		if (tok.t === 'LP') parenDepth++;
		else if (tok.t === 'RP') parenDepth--;
		if (tok.t === 'KW' && tok.v === 'CASE') caseDepth++;

		const inBlock = parenDepth > 0 || caseDepth > 0 || beginDepth > 0;

		if (!inBlock && tok.t === 'KW' && TOP_CLAUSE_KWS.has(tok.v)) {
			if (cur) clauses.push(cur);
			cur = { type: tok.v, tokens: [] };
		} else if (cur) {
			cur.tokens.push(tok);
			// Track depths AFTER pushing into current clause
			if (tok.t === 'KW' && tok.v === 'BEGIN') beginDepth++;
			else if (tok.t === 'KW' && tok.v === 'END') {
				if (caseDepth > 0) caseDepth--;
				else if (beginDepth > 0) beginDepth--;
			}
		} else {
			// Token before any clause keyword — wrap in passthrough
			cur = { type: '_', tokens: [tok] };
		}
	}
	if (cur) clauses.push(cur);
	return clauses;
}

// ════════════════════════════════════════════════════════════════════════════
// ALIAS EXTRACTION — strips AS per Rule 1 (except in DECLARE where AS is kept)
// ════════════════════════════════════════════════════════════════════════════

function extractAlias(tokens) {
	// Strip AS keyword: [..., AS, alias]
	const asIdx = tokens.findLastIndex(t => t.t === 'KW' && t.v === 'AS');
	if (asIdx >= 0 && asIdx === tokens.length - 2) {
		const aliasToken = tokens[asIdx + 1];
		const alias = (aliasToken.t === 'BID') ? aliasToken.v : `[${aliasToken.v}]`;
		return { expr: tokens.slice(0, asIdx), alias };
	}
	// Implicit alias: last token is [bracketed] and prev is not DOT/LP/KW
	const last = tokens[tokens.length - 1];
	const prev = tokens[tokens.length - 2];
	if (last?.t === 'BID' && prev && prev.t !== 'DOT' && prev.t !== 'LP' && prev.t !== 'KW') {
		return { expr: tokens.slice(0, -1), alias: last.v };
	}
	return { expr: tokens, alias: null };
}

function bracketAlias(raw) {
	if (!raw) return null;
	if (raw.startsWith('[')) return raw;
	return `[${raw}]`;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 4 — SELECT CLAUSE
// ════════════════════════════════════════════════════════════════════════════

function formatSelectClause(clauseTokens, noColumnNumbers) {
	// Strip NL tokens
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	let i = 0;
	let modifiers = '';

	if (clauseTokens[i]?.t === 'KW' && clauseTokens[i]?.v === 'TOP') {
		i++;
		modifiers += 'TOP ' + (clauseTokens[i++]?.v || '') + ' ';
	}
	if (clauseTokens[i]?.t === 'KW' && clauseTokens[i]?.v === 'DISTINCT') {
		i++;
		modifiers += 'DISTINCT ';
	}

	const remaining = clauseTokens.slice(i);

	if (remaining.length === 1 && remaining[0].t === 'STAR') {
		return 'SELECT\t' + modifiers + '*';
	}

	const colGroups = splitAtCommas(remaining);
	if (!colGroups.length) return 'SELECT\t*';

	const parsed = colGroups.map((toks, idx) => parseSelectColumn(toks, idx));

	const firstPrefix = 'SELECT\t' + modifiers;
	const contPrefix = T + T + ', ';

	const normalLengths = parsed.map((col, idx) => {
		if (col.isMultiLine || col.isLong) return 0;
		const prefix = idx === 0 ? firstPrefix : contPrefix;
		return (prefix + col.mainLine).length;
	});
	const alignAt = normalLengths.some(l => l > 0) ? Math.max(...normalLengths) : 0;

	const lines = [];
	for (let idx = 0; idx < parsed.length; idx++) {
		const col = parsed[idx];
		const prefix = idx === 0 ? firstPrefix : contPrefix;
		const comment = noColumnNumbers ? '' : ('  ' + colComment(idx));

		if (col.isMultiLine) {
			const adjusted = [...col.lines];
			if (idx === 0) {
				adjusted[0] = adjusted[0].replace(/^\t\t, \(/, T + T + '  (');
			}
			adjusted[adjusted.length - 1] = adjusted[adjusted.length - 1] + comment;
			lines.push(...adjusted);
		} else if (col.isLong) {
			lines.push(prefix + col.mainLine + comment);
		} else {
			const full = prefix + col.mainLine;
			const pad = alignAt > full.length ? ' '.repeat(alignAt - full.length + 1) : '  ';
			lines.push(full + (noColumnNumbers ? '' : (pad + colComment(idx))));
		}
	}

	return lines.join('\n');
}

function parseSelectColumn(tokens, idx) {
	tokens = tokens.filter(t => t.t !== 'NL');

	if (tokens[0]?.t === 'KW' && tokens[0]?.v === 'CASE') return formatCaseColumn(tokens, idx, false);
	if (tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'CASE') return formatCaseColumn(tokens, idx, true);
	if (tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'SELECT') return formatSubqueryColumn(tokens, idx);

	const hasOver = tokens.some(t => t.t === 'KW' && t.v === 'OVER');
	const { expr, alias } = extractAlias(tokens);
	const exprStr = tokStr(expr);
	const aliasStr = alias ? bracketAlias(alias) : null;
	const mainLine = aliasStr ? exprStr + ' ' + aliasStr : exprStr;

	const longKws = new Set(['CASE','CAST','CONVERT','ISNULL','COALESCE','OVER',
		'ROW_NUMBER','RANK','DENSE_RANK','FIRST_VALUE','LAST_VALUE','LAG','LEAD']);
	const isLong = hasOver || mainLine.length > 80 || tokens.some(t => longKws.has(t.v));

	return { isMultiLine: false, isLong, mainLine };
}

// Rule 10 — CASE column
function formatCaseColumn(tokens, idx, hasOuterParens) {
	tokens = tokens.filter(t => t.t !== 'NL');
	let caseTokens = tokens;
	let alias = null;

	if (hasOuterParens) {
		const parenEnd = findMatchingParen(tokens, 0);
		caseTokens = tokens.slice(1, parenEnd);
		const afterParen = tokens.slice(parenEnd + 1).filter(t => !(t.t === 'KW' && t.v === 'AS'));
		if (afterParen.length) alias = afterParen[afterParen.length - 1].v;
	} else {
		const endIdx = tokens.findLastIndex(t => t.v === 'END');
		if (endIdx >= 0) {
			const rest = tokens.slice(endIdx + 1).filter(t => !(t.t === 'KW' && t.v === 'AS'));
			if (rest.length) alias = rest[rest.length - 1].v;
			caseTokens = tokens.slice(0, endIdx + 1);
		}
	}

	const aliasStr = alias ? bracketAlias(alias) : '';
	const lines = [];
	lines.push(T + T + ', (');
	lines.push(...emitCaseLines(caseTokens, T + T + T));
	lines.push(T + T + ') ' + aliasStr);
	return { isMultiLine: true, isLong: false, lines };
}

function emitCaseLines(tokens, indent) {
	tokens = tokens.filter(t => t.t !== 'NL');
	const lines = [];
	let i = 0;
	if (tokens[i]?.v === 'CASE') i++;

	let simpleExpr = null;
	if (tokens[i] && tokens[i].v !== 'WHEN') {
		const exprToks = [];
		while (i < tokens.length && tokens[i].v !== 'WHEN') exprToks.push(tokens[i++]);
		simpleExpr = tokStr(exprToks);
	}
	lines.push(indent + 'CASE' + (simpleExpr ? ' ' + simpleExpr : ''));

	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.v === 'WHEN') {
			i++;
			const whenToks = [];
			while (i < tokens.length && tokens[i].v !== 'THEN') whenToks.push(tokens[i++]);
			lines.push(indent + T + 'WHEN ' + tokStr(whenToks));
			if (tokens[i]?.v === 'THEN') i++;
			const thenToks = [];
			while (i < tokens.length && !['WHEN','ELSE','END'].includes(tokens[i].v)) {
				if (tokens[i].v === 'CASE') {
					const cnt = collectCaseBlock(tokens, i);
					lines.push(...emitCaseLines(tokens.slice(i, i + cnt), indent + T + T));
					i += cnt;
				} else { thenToks.push(tokens[i++]); }
			}
			if (thenToks.length) lines.push(indent + T + T + 'THEN ' + tokStr(thenToks));
		} else if (tok.v === 'ELSE') {
			i++;
			const elseToks = [];
			while (i < tokens.length && tokens[i].v !== 'END') elseToks.push(tokens[i++]);
			lines.push(indent + T + 'ELSE ' + tokStr(elseToks));
		} else if (tok.v === 'END') {
			i++;
		} else { i++; }
	}
	lines.push(indent + 'END');
	return lines;
}

function collectCaseBlock(tokens, idx) {
	let depth = 0, i = idx;
	while (i < tokens.length) {
		if (tokens[i].v === 'CASE') depth++;
		if (tokens[i].v === 'END') { depth--; if (depth === 0) return i - idx + 1; }
		i++;
	}
	return i - idx;
}

// Rule 11 — inline subquery column
function formatSubqueryColumn(tokens, idx) {
	tokens = tokens.filter(t => t.t !== 'NL');
	const parenEnd = findMatchingParen(tokens, 0);
	const innerTokens = tokens.slice(1, parenEnd);
	const afterParen = tokens.slice(parenEnd + 1);
	let alias = null;
	if (afterParen.length) {
		const aft = afterParen.filter(t => !(t.t === 'KW' && t.v === 'AS'));
		if (aft.length) alias = aft[aft.length - 1].v;
	}
	const aliasStr = alias ? bracketAlias(alias) : '';
	const innerFormatted = formatSelectStatement(innerTokens, true);
	const lines = [];
	lines.push(T + T + ', (');
	innerFormatted.split('\n').forEach(l => lines.push(T + T + T + l));
	lines.push(T + T + ') ' + aliasStr);
	return { isMultiLine: true, isLong: false, lines };
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 5 — FROM + JOIN
// ════════════════════════════════════════════════════════════════════════════

const JOIN_START_KWS = new Set(['JOIN','INNER','LEFT','RIGHT','FULL','CROSS','OUTER','APPLY']);

function formatFromClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const blocks = splitFromBlocks(clauseTokens);
	if (!blocks.length) return 'FROM';

	const lines = [];
	const [main, ...joins] = blocks;
	lines.push('FROM\t' + formatTableRef(main.tokens));

	for (const block of joins) {
		const onIdx = block.tokens.findIndex(t => t.t === 'KW' && t.v === 'ON');
		const tableToks = onIdx >= 0 ? block.tokens.slice(0, onIdx) : block.tokens;
		const onToks = onIdx >= 0 ? block.tokens.slice(onIdx + 1) : [];

		lines.push(T + T + block.joinType + ' ' + formatTableRef(tableToks));

		if (onToks.length) {
			const conditions = splitAtTopKws(onToks, new Set(['AND', 'OR']));
			conditions.forEach(({ kw, tokens: ct }, ci) => {
				if (!ct.length) return;
				lines.push(ci === 0
					? T + T + T + 'ON' + T + tokStr(ct)
					: T + T + T + kw + T + tokStr(ct));
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
			let jt = tok.v; i++;
			while (i < tokens.length && tokens[i].t === 'KW' &&
				(JOIN_START_KWS.has(tokens[i].v) || tokens[i].v === 'APPLY')) {
				jt += ' ' + tokens[i].v; i++;
			}
			cur = { joinType: jt, tokens: [] };
			continue;
		}
		cur.tokens.push(tok); i++;
	}
	blocks.push(cur);
	return blocks.filter(b => b.tokens.length > 0 || b.joinType);
}

function formatTableRef(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL');
	if (!tokens.length) return '';

	// Derived table
	if (tokens[0]?.t === 'LP') {
		const parenEnd = findMatchingParen(tokens, 0);
		const inner = tokens.slice(1, parenEnd);
		const after = tokens.slice(parenEnd + 1);
		let alias = '';
		if (after.length) {
			const aft = after.filter(t => !(t.t === 'KW' && t.v === 'AS'));
			if (aft.length) alias = ' ' + bracketAlias(aft[aft.length - 1].v);
		}
		const innerFmt = formatSelectStatement(inner, true);
		return '(\n' + innerFmt.split('\n').map(l => T + T + T + T + l).join('\n') + '\n' + T + T + ')' + alias;
	}

	// Strip table hints WITH (NOLOCK) etc.
	let mainTokens = tokens;
	const withIdx = tokens.findIndex(t => t.t === 'KW' && t.v === 'WITH');
	let hintStr = '';
	if (withIdx >= 0 && tokens[withIdx + 1]?.t === 'LP') {
		mainTokens = tokens.slice(0, withIdx);
		const hintEnd = findMatchingParen(tokens, withIdx + 1);
		hintStr = ' WITH (' + tokStr(tokens.slice(withIdx + 2, hintEnd)) + ')';
	}

	const { expr, alias } = extractAlias(mainTokens);
	let tableStr = tokStr(expr);

	// Add dbo. only to bare plain table names (not @vars, #temps, TVFs, keywords)
	const noSchema = !tableStr.includes('.');
	const notSpecial = !/^[@#]/.test(tableStr);
	const notFn = !expr.some(t => t.t === 'LP');
	const notTVF = !TVF_NAMES.has(tableStr.toUpperCase());
	const notKw = !KEYWORDS.has(tableStr.toUpperCase()) || DATATYPES.has(tableStr.toUpperCase());
	if (noSchema && notSpecial && notFn && notTVF && notKw) tableStr = 'dbo.' + tableStr;

	const aliasPart = alias ? ' ' + bracketAlias(alias) : '';
	return tableStr + aliasPart + hintStr;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 6 — WHERE CLAUSE
// ════════════════════════════════════════════════════════════════════════════

function formatWhereClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const segments = splitAtTopKws(clauseTokens, new Set(['AND', 'OR']));
	const validSegs = segments.filter(s => s.tokens.length > 0);
	const lines = [];

	validSegs.forEach(({ kw, tokens: gt }, i) => {
		const condLines = formatConditionGroup(gt);
		if (i === 0) {
			lines.push(T + 'WHERE\t(');
			condLines.forEach(cl => lines.push(T + T + T + cl));
			lines.push(T + T + ')');
		} else {
			lines.push(T + T + kw);
			lines.push(T + T + '(');
			condLines.forEach(cl => lines.push(T + T + T + cl));
			lines.push(T + T + ')');
		}
	});
	return lines.join('\n');
}

function formatConditionGroup(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL');
	if (!tokens.length) return [];

	// Strip outer parens if the ENTIRE condition is wrapped: ( ... )
	if (tokens[0]?.t === 'LP' && findMatchingParen(tokens, 0) === tokens.length - 1) {
		tokens = tokens.slice(1, -1);
	}

	// EXISTS / NOT EXISTS
	const firstKw = tokens[0]?.v;
	if (firstKw === 'EXISTS' || (firstKw === 'NOT' && tokens[1]?.v === 'EXISTS')) {
		const isNot = firstKw === 'NOT';
		const prefix = isNot ? 'NOT EXISTS' : 'EXISTS';
		const skip = isNot ? 2 : 1;
		if (tokens[skip]?.t === 'LP') {
			const parenEnd = findMatchingParen(tokens, skip);
			const inner = tokens.slice(skip + 1, parenEnd);
			const innerFmt = formatSelectStatement(inner, true);
			return [prefix + ' (', ...innerFmt.split('\n').map(l => T + l), ')'];
		}
	}

	// NOT IN / IN  
	const notIdx = tokens.findIndex(t => t.v === 'NOT');
	const inIdx = tokens.findIndex(t => t.t === 'KW' && t.v === 'IN');
	const effectiveNotIn = (notIdx >= 0 && tokens[notIdx + 1]?.v === 'IN') ? notIdx : -1;
	const effectiveIn = effectiveNotIn >= 0 ? effectiveNotIn : inIdx;

	if (effectiveIn >= 0) {
		const isNotIn = effectiveNotIn >= 0;
		const inKwIdx = isNotIn ? effectiveIn + 1 : effectiveIn;
		if (tokens[inKwIdx + 1]?.t === 'LP') {
			const colStr = tokStr(tokens.slice(0, effectiveIn));
			const listEnd = findMatchingParen(tokens, inKwIdx + 1);
			const listToks = tokens.slice(inKwIdx + 2, listEnd);
			const inOp = isNotIn ? 'NOT IN' : 'IN';

			if (listToks[0]?.t === 'KW' && listToks[0]?.v === 'SELECT') {
				const inner = formatSelectStatement(listToks, true);
				return [colStr + ' ' + inOp + ' (', ...inner.split('\n').map(l => T + l), ')'];
			}
			const items = splitAtCommas(listToks);
			if (items.length >= 4) {
				const out = [colStr + ' ' + inOp + ' ('];
				items.forEach((it, ii) => out.push((ii === 0 ? T + T : T + T + ', ') + tokStr(it)));
				out.push(')');
				return out;
			}
		}
	}

	return [tokStr(tokens)];
}

// ════════════════════════════════════════════════════════════════════════════
// RULES 7, 8, 9 — GROUP BY / ORDER BY / OFFSET FETCH
// ════════════════════════════════════════════════════════════════════════════

function formatGroupByClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const toks = clauseTokens[0]?.v === 'BY' ? clauseTokens.slice(1) : clauseTokens;
	const cols = splitAtCommas(toks);
	const lines = ['GROUP BY'];
	cols.forEach((ct, i) => lines.push((i === 0 ? T + T : T + T + ', ') + tokStr(ct)));
	return lines.join('\n');
}

function formatOrderByClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	let toks = clauseTokens[0]?.v === 'BY' ? clauseTokens.slice(1) : clauseTokens;
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

function formatHavingClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const segments = splitAtTopKws(clauseTokens, new Set(['AND', 'OR']));
	const lines = [];
	segments.filter(s => s.tokens.length).forEach(({ kw, tokens: gt }, i) => {
		const condLines = formatConditionGroup(gt);
		if (i === 0) {
			lines.push(T + 'HAVING\t(');
			condLines.forEach(cl => lines.push(T + T + T + cl));
			lines.push(T + T + ')');
		} else {
			lines.push(T + T + kw);
			lines.push(T + T + '(');
			condLines.forEach(cl => lines.push(T + T + T + cl));
			lines.push(T + T + ')');
		}
	});
	return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// RULES 3, 15 — DECLARE / SET
// ════════════════════════════════════════════════════════════════════════════

function formatDeclareClause(clauseTokens) {
	// Keep AS in DECLARE (e.g. DECLARE @x AS XML) — matches expected output
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	return 'DECLARE ' + tokStr(clauseTokens);
}

function formatSetClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const eqIdx = clauseTokens.findIndex(t => t.t === 'OP' && t.v === '=');
	if (eqIdx >= 0) {
		const lhs = tokStr(clauseTokens.slice(0, eqIdx));
		let rhs = clauseTokens.slice(eqIdx + 1);

		// Strip outer parens from rhs if fully wrapped
		if (rhs[0]?.t === 'LP' && findMatchingParen(rhs, 0) === rhs.length - 1) {
			rhs = rhs.slice(1, -1);
		}

		if (rhs[0]?.v === 'CASE') {
			const caseLines = emitCaseLines(rhs, T);
			return ['SET ' + lhs + ' = (', ...caseLines, ')'].join('\n');
		}
		if (rhs[0]?.v === 'SELECT') {
			const inner = formatSelectStatement(rhs, true);
			return ['SET ' + lhs + ' = (', ...inner.split('\n').map(l => T + l), ')'].join('\n');
		}
	}

	// Check for trailing inline comment — keep it on same line
	const lastComment = clauseTokens.findLastIndex(t => t.t === 'COMMENT');
	if (lastComment >= 0) {
		const main = clauseTokens.slice(0, lastComment).filter(t => t.t !== 'COMMENT');
		const comment = clauseTokens[lastComment].v;
		return 'SET ' + tokStr(main) + ' ' + comment;
	}

	return 'SET ' + tokStr(clauseTokens);
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 14 — IF / WHILE blocks
// ════════════════════════════════════════════════════════════════════════════

function formatIfClause(clauseTokens, indent) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const lines = [];
	let i = 0;

	// Collect condition (everything before BEGIN)
	const condToks = [];
	while (i < clauseTokens.length && clauseTokens[i]?.v !== 'BEGIN') {
		condToks.push(clauseTokens[i++]);
	}
	lines.push('IF ' + tokStr(condToks));

	if (clauseTokens[i]?.v === 'BEGIN') {
		i++;
		lines.push('BEGIN');
		lines.push('');

		// Collect body up to matching END
		const bodyToks = [];
		let depth = 1, caseD = 0;
		while (i < clauseTokens.length) {
			const tok = clauseTokens[i];
			if (tok.t === 'KW' && tok.v === 'CASE') caseD++;
			if (tok.t === 'KW' && tok.v === 'BEGIN') depth++;
			if (tok.t === 'KW' && tok.v === 'END') {
				if (caseD > 0) { caseD--; }
				else { depth--; if (depth === 0) { i++; break; } }
			}
			bodyToks.push(tok); i++;
		}

		formatProcBody(bodyToks, indent + T).forEach(l => lines.push(l === '' ? '' : T + l));
		lines.push('');
		lines.push('END');
	}

	// ELSE
	if (i < clauseTokens.length && clauseTokens[i]?.v === 'ELSE') {
		i++;
		lines.push('ELSE');
		if (clauseTokens[i]?.v === 'BEGIN') {
			i++;
			lines.push('BEGIN');
			lines.push('');
			const elseToks = [];
			let depth = 1, caseD = 0;
			while (i < clauseTokens.length) {
				const tok = clauseTokens[i];
				if (tok.t === 'KW' && tok.v === 'CASE') caseD++;
				if (tok.t === 'KW' && tok.v === 'BEGIN') depth++;
				if (tok.t === 'KW' && tok.v === 'END') {
					if (caseD > 0) { caseD--; }
					else { depth--; if (depth === 0) break; }
				}
				elseToks.push(tok); i++;
			}
			formatProcBody(elseToks, indent + T).forEach(l => lines.push(l === '' ? '' : T + l));
			lines.push('');
			lines.push('END');
		}
	}

	return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 2 — STORED PROCEDURE BODY FORMATTER
// ════════════════════════════════════════════════════════════════════════════

function formatProcBody(tokens, indent) {
	indent = indent || T;
	tokens = tokens.filter(t => t.t !== 'NL');
	const clauses = splitIntoClauses(tokens);
	const lines = [];

	// Rule 2: group only the LEADING DECLARE block, then leading SET block,
	// then emit rest in original order (preserving mid-body DECLAREs in place).
	let ci = 0;
	while (ci < clauses.length && clauses[ci].type === 'DECLARE') ci++;
	const leadDeclares = clauses.slice(0, ci);
	let si = ci;
	while (si < clauses.length && clauses[si].type === 'SET') si++;
	const leadSets = clauses.slice(ci, si);
	const rest = clauses.slice(si);

	if (leadDeclares.length) {
		leadDeclares.forEach(d => lines.push(formatDeclareClause(d.tokens)));
		lines.push('');
	}
	if (leadSets.length) {
		leadSets.forEach(s => {
			const fmt = formatSetClause(s.tokens);
			fmt.split('\n').forEach(l => lines.push(l));
		});
		lines.push('');
	}

	rest.forEach(c => {
		if (c.type === 'RETURN') {
			lines.push('RETURN');
			return;
		}
		if (c.type === 'IF') {
			const fmt = formatIfClause(c.tokens, indent);
			fmt.split('\n').forEach(l => lines.push(l));
			lines.push('');
			return;
		}
		if (c.type === 'INSERT') {
			formatInsertClause(c.tokens).forEach(l => lines.push(l));
			lines.push('');
			return;
		}
		const fmt = formatClause(c);
		fmt.split('\n').forEach(l => lines.push(l));
		lines.push('');
	});

	// Trim trailing blank lines
	while (lines.length && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// INSERT INTO — basic passthrough with SELECT formatting
// ════════════════════════════════════════════════════════════════════════════

function formatInsertClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	// INSERT INTO @table SELECT ...
	const selectIdx = clauseTokens.findIndex(t => t.t === 'KW' && t.v === 'SELECT');
	if (selectIdx >= 0) {
		const intoToks = clauseTokens.slice(0, selectIdx);
		const selectToks = clauseTokens.slice(selectIdx);
		const lines = [];
		lines.push('INSERT INTO ' + tokStr(intoToks.filter(t => !(t.t === 'KW' && t.v === 'INTO'))));
		const selectFmt = formatSelectStatement(selectToks, true);
		selectFmt.split('\n').forEach(l => lines.push(l));
		return lines;
	}
	return ['INSERT ' + tokStr(clauseTokens)];
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 2 — STORED PROCEDURE HEADER
// ════════════════════════════════════════════════════════════════════════════

function formatProcStatement(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL' && t.t !== 'GO');
	let i = 0;

	// Skip any leading comments before CREATE/ALTER
	while (i < tokens.length && tokens[i].t === 'COMMENT') i++;

	const action = tokens[i++]?.v || 'ALTER'; // CREATE or ALTER

	// Skip PROCEDURE / PROC keyword
	if (tokens[i]?.t === 'KW' && (tokens[i]?.v === 'PROCEDURE' || tokens[i]?.v === 'PROC')) i++;

	// Proc name
	let procName = '';
	while (i < tokens.length && (tokens[i].t === 'ID' || tokens[i].t === 'BID' || tokens[i].t === 'DOT')) {
		procName += tokens[i].v; i++;
	}
	if (!procName.includes('.')) procName = 'dbo.' + procName;

	const lines = [`${action} PROCEDURE ${procName}`];

	// Parameters — scan until we hit WITH (for RECOMPILE/ENCRYPTION/EXECUTE AS)
	// OR until we hit a bare AS that is the proc body AS
	// The trick: WITH EXECUTE AS CALLER must be skipped entirely
	// We detect param block end by: first non-param, non-COMMA token at depth 0
	// that is AS/WITH at the top level

	const params = [];

	while (i < tokens.length) {
		const tok = tokens[i];

		// Stop conditions for param block
		if (tok.t === 'KW' && tok.v === 'WITH') {
			// Could be WITH EXECUTE AS (skip entirely) or WITH RECOMPILE/ENCRYPTION
			// Peek ahead to decide
			const j = i + 1;
			if (tokens[j]?.v === 'EXECUTE' || tokens[j]?.v === 'EXEC') {
				// WITH EXECUTE AS CALLER — skip the whole thing until the proc-body AS
				i += 2; // skip WITH EXECUTE
				if (tokens[i]?.v === 'AS') i++; // skip AS
				if (tokens[i]?.t === 'ID') i++; // skip CALLER / OWNER / SELF / user
				continue;
			}
			// WITH RECOMPILE or ENCRYPTION — handled below
			break;
		}
		if (tok.t === 'KW' && tok.v === 'AS') break;
		if (tok.t === 'COMMENT') {
			// Attach comment to last param
			if (params.length > 0) params[params.length - 1].trailingComment = tok.v;
			i++; continue;
		}
		if (tok.t === 'VAR') {
			const param = parseProcParam(tokens, i);
			params.push(param);
			i = param.nextIdx;
			if (tokens[i]?.t === 'COMMA') i++;
			continue;
		}
		i++;
	}

	// Rule 2: first param = tab indent, rest = tab + ", "
	params.forEach((p, pi) => {
		const parts = [p.name + ' ' + p.datatype];
		if (p.defaultVal !== null) parts.push('= ' + p.defaultVal);
		if (p.isOutput) parts.push('OUTPUT');
		const indent = pi === 0 ? T : T + ', ';
		const comment = p.trailingComment ? '\t' + p.trailingComment : '';
		lines.push(indent + parts.join(' ') + comment);
	});

	// WITH RECOMPILE / ENCRYPTION (if present and not EXECUTE AS)
	if (i < tokens.length && tokens[i]?.v === 'WITH') {
		i++;
		const opts = [];
		if (tokens[i]?.v === 'RECOMPILE') { opts.push('RECOMPILE'); i++; }
		else if (tokens[i]?.v === 'ENCRYPTION') { opts.push('ENCRYPTION'); i++; }
		if (opts.length) lines.push('WITH ' + opts.join(', '));
	}

	lines.push('AS');
	lines.push('BEGIN');
	lines.push('');

	// Skip to body: advance past AS and optional BEGIN in token stream
	while (i < tokens.length && tokens[i]?.v !== 'AS') i++;
	i++; // skip AS
	if (i < tokens.length && tokens[i]?.v === 'BEGIN') i++; // skip BEGIN if present

	// Collect body tokens up to the matching END, tracking CASE depth separately
	const bodyToks = [];
	let depth = 1, caseD = 0;
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.t === 'GO') { i++; continue; } // skip GO inside body
		if (tok.t === 'KW' && tok.v === 'CASE') caseD++;
		if (tok.t === 'KW' && tok.v === 'BEGIN') depth++;
		if (tok.t === 'KW' && tok.v === 'END') {
			if (caseD > 0) { caseD--; }
			else { depth--; if (depth === 0) break; }
		}
		bodyToks.push(tok); i++;
	}

	// If there was no BEGIN in original SQL (bare AS body), depth never hit 0
	// bodyToks still has all the body content — that's fine

	formatProcBody(bodyToks, T).forEach(l => lines.push(l === '' ? '' : T + l));
	lines.push('');
	lines.push('END');

	return lines.join('\n');
}

function parseProcParam(tokens, startIdx) {
	let i = startIdx;
	const name = tokens[i++]?.v || '';

	let datatype = '';
	if (tokens[i]?.t === 'DT' || tokens[i]?.t === 'BID' ||
		(tokens[i]?.t === 'KW' && DATATYPES.has(tokens[i]?.v))) {
		datatype = tokens[i++].v;
		if (tokens[i]?.t === 'LP') {
			datatype += ' ('; i++;
			while (i < tokens.length && tokens[i]?.t !== 'RP') datatype += tokens[i++].v;
			datatype += ')'; i++;
		}
	}

	if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'READONLY') { datatype += ' READONLY'; i++; }

	let defaultVal = null, isOutput = false;

	if (tokens[i]?.t === 'OP' && tokens[i]?.v === '=') {
		i++;
		const defToks = [];
		while (i < tokens.length) {
			const t = tokens[i];
			if (t.t === 'COMMA') break;
			if (t.t === 'KW' && ['OUTPUT','WITH','AS'].includes(t.v)) break;
			if (t.t === 'COMMENT') break;
			defToks.push(t); i++;
		}
		defaultVal = tokStr(defToks);
	}

	if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'OUTPUT') { isOutput = true; i++; }

	return { name, datatype, defaultVal, isOutput, trailingComment: null, nextIdx: i };
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 12 — CTE
// ════════════════════════════════════════════════════════════════════════════

function formatCTE(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL' && t.t !== 'GO');
	const lines = [';WITH', ''];
	let i = 0;
	const cteBlocks = [];

	while (i < tokens.length) {
		while (i < tokens.length && tokens[i].t === 'COMMA') i++;
		if (tokens[i]?.t === 'KW' && ['SELECT','INSERT','UPDATE','DELETE','MERGE'].includes(tokens[i].v)) break;
		if (!tokens[i]) break;

		let description = null;
		if (tokens[i]?.t === 'COMMENT') { description = tokens[i].v; i++; }

		const nameTok = tokens[i++];
		if (!nameTok || (nameTok.t !== 'ID' && nameTok.t !== 'BID')) break;

		if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'AS') i++;
		if (tokens[i]?.t !== 'LP') break;
		const parenEnd = findMatchingParen(tokens, i);
		const bodyToks = tokens.slice(i + 1, parenEnd);
		i = parenEnd + 1;
		cteBlocks.push({ name: nameTok.v, description, bodyToks });
	}

	const mainToks = tokens.slice(i);

	cteBlocks.forEach((cte, ci) => {
		if (cte.description) lines.push(cte.description);
		lines.push(cte.name);
		lines.push('AS');
		lines.push('(');
		const inner = formatSelectStatement(cte.bodyToks, false);
		inner.split('\n').forEach(l => lines.push(T + l));
		lines.push(ci < cteBlocks.length - 1 ? '),' : ')');
		lines.push('');
	});

	if (mainToks.length) lines.push(formatSelectStatement(mainToks, false));
	return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 13 — UNION ALL / UNION / INTERSECT / EXCEPT
// ════════════════════════════════════════════════════════════════════════════

function formatSetOperators(clauses) {
	const blocks = [];
	let cur = [];
	for (const clause of clauses) {
		if (['UNION','INTERSECT','EXCEPT'].includes(clause.type)) {
			if (cur.length) blocks.push({ type: 'SELECT', clauses: cur });
			cur = [];
			blocks.push({ type: clause.type, tokens: clause.tokens });
		} else { cur.push(clause); }
	}
	if (cur.length) blocks.push({ type: 'SELECT', clauses: cur });

	const parts = [];
	for (const block of blocks) {
		if (block.type === 'SELECT') {
			parts.push(block.clauses.map(formatClause).join('\n\n'));
		} else {
			const allKw = block.tokens.some(t => t.v === 'ALL') ? ' ALL' : '';
			parts.push(block.type + allKw);
		}
	}
	return parts.join('\n\n');
}

// ════════════════════════════════════════════════════════════════════════════
// CLAUSE DISPATCHER
// ════════════════════════════════════════════════════════════════════════════

function formatClause(clause) {
	switch (clause.type) {
		case 'SELECT':   return formatSelectClause(clause.tokens, false);
		case 'FROM':     return formatFromClause(clause.tokens);
		case 'WHERE':    return formatWhereClause(clause.tokens);
		case 'ORDER':    return formatOrderByClause(clause.tokens);
		case 'GROUP':    return formatGroupByClause(clause.tokens);
		case 'HAVING':   return formatHavingClause(clause.tokens);
		case 'DECLARE':  return formatDeclareClause(clause.tokens);
		case 'SET':      return formatSetClause(clause.tokens);
		case 'IF':       return formatIfClause(clause.tokens, T);
		case 'INSERT':   return formatInsertClause(clause.tokens).join('\n');
		case 'RETURN':   return 'RETURN';
		case 'EXEC':
		case 'EXECUTE':  return clause.type + (clause.tokens.length ? ' ' + tokStr(clause.tokens) : '');
		case 'PRINT':    return 'PRINT ' + tokStr(clause.tokens);
		case 'RAISERROR':return 'RAISERROR ' + tokStr(clause.tokens);
		case 'THROW':    return 'THROW ' + tokStr(clause.tokens);
		default:         return clause.type + (clause.tokens.length ? ' ' + tokStr(clause.tokens) : '');
	}
}

// ════════════════════════════════════════════════════════════════════════════
// SELECT STATEMENT  (recursive — used by subqueries / CTEs)
// ════════════════════════════════════════════════════════════════════════════

function formatSelectStatement(tokens, noColumnNumbers) {
	tokens = tokens.filter(t => t.t !== 'NL' && t.t !== 'GO');
	const clauses = splitIntoClauses(tokens);
	const hasSetOps = clauses.some(c => ['UNION','INTERSECT','EXCEPT'].includes(c.type));
	if (hasSetOps) return formatSetOperators(clauses);
	return clauses.map(c => {
		if (c.type === 'SELECT') return formatSelectClause(c.tokens, noColumnNumbers);
		return formatClause(c);
	}).join('\n\n');
}

// ════════════════════════════════════════════════════════════════════════════
// BATCH-LEVEL SPLITTER — handles SET ANSI_NULLS / GO / comments before proc
// ════════════════════════════════════════════════════════════════════════════

function splitBatches(tokens) {
	// Split token stream at GO tokens into batches
	const batches = [];
	let cur = [];
	for (const tok of tokens) {
		if (tok.t === 'GO') {
			batches.push(cur);
			cur = [];
		} else {
			cur.push(tok);
		}
	}
	if (cur.length) batches.push(cur);
	return batches;
}

function formatBatch(tokens) {
	// Strip leading NL
	tokens = tokens.filter(t => t.t !== 'NL');
	if (!tokens.length) return null;

	// Pure comment batch
	if (tokens.every(t => t.t === 'COMMENT')) {
		return tokens.map(t => t.v).join('\n');
	}

	const firstKw = tokens.find(t => t.t === 'KW');
	if (!firstKw) {
		// Could be SET ANSI_NULLS ON or similar — just emit as-is
		return tokStr(tokens);
	}

	// Stored procedure — preserve any leading comments before CREATE/ALTER
	if (firstKw.v === 'CREATE' || firstKw.v === 'ALTER') {
		const firstIdx = tokens.indexOf(firstKw);
		const nextKw = tokens.slice(firstIdx + 1).find(t => t.t === 'KW');
		if (nextKw?.v === 'PROCEDURE' || nextKw?.v === 'PROC') {
			// Emit any leading comments on their own lines, then the proc
			const leadingComments = [];
			for (let ci = 0; ci < firstIdx; ci++) {
				if (tokens[ci].t === 'COMMENT') leadingComments.push(tokens[ci].v);
			}
			const procFormatted = formatProcStatement(tokens);
			if (leadingComments.length) {
				return leadingComments.join('\n') + '\n' + procFormatted;
			}
			return procFormatted;
		}
	}

	// CTE
	if (firstKw.v === 'WITH') {
		const withIdx = tokens.indexOf(firstKw);
		// Check for ;WITH (leading SEMI already stripped or not)
		return formatCTE(tokens.slice(withIdx + 1));
	}

	return formatSelectStatement(tokens, false);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

function formatSQL(sql) {
	try {
		const tokens = tokenize(sql);
		if (!tokens.length) return sql;

		// Handle leading ;
		let workTokens = tokens;
		if (workTokens[0]?.t === 'SEMI') workTokens = workTokens.slice(1);

		// Check for CTE starting with ; WITH
		const firstMeaningful = workTokens.find(t => t.t !== 'NL');
		if (firstMeaningful?.t === 'KW' && firstMeaningful.v === 'WITH') {
			const withIdx = workTokens.indexOf(firstMeaningful);
			return formatCTE(workTokens.slice(withIdx + 1));
		}

		// Split at GO tokens for multi-batch scripts
		const batches = splitBatches(workTokens);

		if (batches.length <= 1) {
			// Single batch — original behaviour
			const result = formatBatch(workTokens.filter(t => t.t !== 'GO'));
			return result || sql;
		}

		// Multi-batch: format each, rejoin with GO
		const formatted = [];
		for (const batch of batches) {
			const result = formatBatch(batch);
			if (result) formatted.push(result);
		}
		return formatted.join('\nGO\n');

	} catch (err) {
		console.error('[SQL Zero Doctrine] formatter error:', err);
		return sql;
	}
}

module.exports = { formatSQL };
