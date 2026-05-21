'use strict';

const INDENT = '\t';

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
	'MATCHED','MERGE','USING',
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
	'ROWS','RANGE','PRECEDING','FOLLOWING','ONLY','OFFSET','NEXT','UNBOUNDED',
	'APPLY','OUTPUT',
	'THROW','TRY','CATCH',
	'STRING_SPLIT','OPENJSON',
]);

const NON_FUNC_LP_KWS = new Set([
	'IN','NOT','AND','OR','BETWEEN','LIKE','IS','CASE','WHEN','THEN','ELSE','END',
	'SET','FROM','WHERE','ON','BY','AS','INTO','OUTPUT','OVER','PIVOT','UNPIVOT',
	'EXISTS','ANY','ALL','SOME','HAVING','SELECT','UPDATE','DELETE','INSERT','MERGE',
	'IF','WHILE','BEGIN','END','RETURN','WITH','USING','MATCHED',
]);

// Registry of CTE names in the current query — excluded from dbo. prefix
const _cteNames = new Set();

const DATATYPES = new Set([
	'BIGINT','BINARY','BIT','CHAR','DATE','DATETIME','DATETIME2','DATETIMEOFFSET',
	'DECIMAL','FLOAT','GEOGRAPHY','GEOMETRY','HIERARCHYID','IMAGE','INT','INTEGER',
	'MONEY','NCHAR','NTEXT','NUMERIC','NVARCHAR','REAL','ROWVERSION','SMALLDATETIME',
	'SMALLINT','SMALLMONEY','SQL_VARIANT','TEXT','TIME','TIMESTAMP','TINYINT',
	'UNIQUEIDENTIFIER','VARBINARY','VARCHAR','XML','TABLE','CURSOR',
]);

const TVF_NAMES = new Set([
	'STRING_SPLIT','OPENJSON','OPENROWSET','OPENQUERY','OPENXML',
	'FREETEXTTABLE','CONTAINSTABLE','CHANGETABLE',
]);

const LONG_COL_KWS = new Set([
	'CASE','CAST','CONVERT','ISNULL','COALESCE','OVER',
	'ROW_NUMBER','RANK','DENSE_RANK','FIRST_VALUE','LAST_VALUE','LAG','LEAD',
]);

let MAX_INLINE_COL_LEN    = 80;    // configurable via formatSQL options
let IN_LIST_BREAK_AT      = 4;     // configurable via formatSQL options
let REORDER_JOIN_ON       = false; // if true, rewrite ON so joined table is on left side

function tokenize(sql) {
	const tokens = [];
	let i = 0;
	const n = sql.length;

	while (i < n) {
		if (sql[i] === '\n') { tokens.push({ t: 'NL', v: '\n' }); i++; continue; }
		if (/[ \t\r]/.test(sql[i])) { i++; continue; }

		if (sql[i] === '-' && sql[i + 1] === '-') {
			let j = i;
			while (j < n && sql[j] !== '\n') j++;
			tokens.push({ t: 'COMMENT', v: sql.slice(i, j) });
			i = j;
			continue;
		}

		if (sql[i] === '/' && sql[i + 1] === '*') {
			let j = i + 2;
			while (j < n - 1 && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
			tokens.push({ t: 'COMMENT', v: sql.slice(i, j + 2) });
			i = j + 2;
			continue;
		}

		if (sql[i] === "'" || (sql[i] === 'N' && sql[i + 1] === "'")) {
			let pfx = '';
			if (sql[i] === 'N') { pfx = 'N'; i++; }
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

		if (sql[i] === '[') {
			let j = i + 1;
			while (j < n && sql[j] !== ']') j++;
			tokens.push({ t: 'BID', v: sql.slice(i, j + 1) });
			i = j + 1;
			continue;
		}

		if (sql[i] === '@') {
			let j = i + 1;
			while (j < n && /\w/.test(sql[j])) j++;
			tokens.push({ t: 'VAR', v: sql.slice(i, j) });
			i = j;
			continue;
		}

		if (/\d/.test(sql[i])) {
			let j = i;
			let hasDot = false;
			while (j < n) {
				if (/\d/.test(sql[j])) { j++; }
				else if (sql[j] === '.' && !hasDot) { hasDot = true; j++; }
				else break;
			}
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

		if (/[a-zA-Z_#$]/.test(sql[i])) {
			let j = i;
			while (j < n && /[\w#$]/.test(sql[j])) j++;
			const raw = sql.slice(i, j);
			const up = raw.toUpperCase();
			if (up === 'GO') {
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

		const two = sql.slice(i, i + 2);
		if (['<>', '<=', '>=', '!=', '+=', '-=', '*=', '/='].includes(two)) {
			tokens.push({ t: 'OP', v: two });
			i += 2;
			continue;
		}

		const ch = sql[i];
		const map = { ',': 'COMMA', '(': 'LP', ')': 'RP', ';': 'SEMI', '.': 'DOT', '*': 'STAR' };
		tokens.push({ t: map[ch] || 'OP', v: ch });
		i++;
	}

	return tokens;
}

function findLastIdx(arr, fn) {
	for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
	return -1;
}

function tokStr(tokens) {
	let out = '';
	for (let i = 0; i < tokens.length; i++) {
		const cur = tokens[i];
		const prev = tokens[i - 1];
		if (!cur || cur.t === 'NL' || cur.t === 'SEMI') continue; // FIX 3: strip semicolons
		if (i === 0) { out += cur.v; continue; }
		if (cur.t === 'COMMENT') { out += ' ' + cur.v; continue; }
		if (cur.t === 'DOT' || (prev && prev.t === 'DOT')) { out += cur.v; continue; }
		if (cur.t === 'RP') { out += cur.v; continue; }
		if (prev && prev.t === 'LP') { out += cur.v; continue; }
		if (cur.t === 'COMMA') { out += cur.v; continue; }
		if (prev && prev.t === 'COMMA') { out += ' ' + cur.v; continue; }
		// ROBUSTNESS FIX 5: No space between function name and its opening paren
		// Only suppress for actual function keywords, not SQL control keywords (IN, AND, etc.)
		if (cur.t === 'LP' && prev) {
			const prevIsFunc = (prev.t === 'KW' && !NON_FUNC_LP_KWS.has(prev.v)) ||
			                   prev.t === 'ID' || prev.t === 'DT' || prev.t === 'BID';
			if (prevIsFunc) { out += cur.v; continue; }
		}
		out += ' ' + cur.v;
	}
	return out;
}

function colComment(idx) {
	return idx < 10 ? `--  ${idx}` : `-- ${idx}`;
}

function splitAtCommas(tokens) {
	const groups = [];
	let cur = [];
	let depth = 0;
	let justSplit = false;
	for (const tok of tokens) {
		if (tok.t === 'NL') continue;
		if (tok.t === 'LP') { depth++; cur.push(tok); justSplit = false; }
		else if (tok.t === 'RP') { depth--; cur.push(tok); justSplit = false; }
		else if (tok.t === 'COMMA' && depth === 0) {
			groups.push(cur); cur = []; justSplit = true;
		} else if (tok.t === 'COMMENT' && justSplit && groups.length) {
			groups[groups.length - 1].push(tok);
		} else {
			cur.push(tok); justSplit = false;
		}
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

const TOP_CLAUSE_KWS = new Set([
	'SELECT','FROM','WHERE','ORDER','GROUP','HAVING',
	'UNION','INTERSECT','EXCEPT',
	'INSERT','UPDATE','DELETE','MERGE',
	'CREATE','ALTER','DROP',
	'DECLARE','SET','IF','WHILE',
	'RETURN','EXEC','EXECUTE','PRINT','RAISERROR','THROW',
	'INTO',
	// Rob 2: previously fell through to _ passthrough
	'USE','TRUNCATE','DBCC','GRANT','REVOKE','WAITFOR',
	'CHECKPOINT','SAVE','CLOSE','DEALLOCATE','OPEN','KILL',
	'DISABLE','ENABLE','BACKUP','RESTORE',
]);

// Keywords that are NOT clause starters when inside a MERGE body
const MERGE_BODY_KWS = new Set(['UPDATE','INSERT','DELETE','WHEN','USING','ON','OUTPUT','SET']);

function splitIntoClauses(tokens) {
	const clauses = [];
	let cur = null;
	let parenDepth = 0;
	let caseDepth = 0;
	let beginDepth = 0;

	let mergeDepth = 0;

	for (const tok of tokens) {
		if (tok.t === 'NL' || tok.t === 'GO') continue;
		if (tok.t === 'LP') parenDepth++;
		else if (tok.t === 'RP') parenDepth--;
		if (tok.t === 'KW' && tok.v === 'CASE') caseDepth++;

		const inBlock = parenDepth > 0 || caseDepth > 0 || beginDepth > 0;

		if (!inBlock && tok.t === 'KW' && TOP_CLAUSE_KWS.has(tok.v)) {
			const lastTok = cur?.tokens[cur.tokens.length - 1];
			const isElseIf = tok.v === 'IF' && lastTok?.t === 'KW' && lastTok?.v === 'ELSE';
			// Suppress INTO as clause-splitter inside INSERT (INSERT INTO is one unit)
			const isInsertInto = tok.v === 'INTO' && cur?.type === 'INSERT';
			if (isElseIf) {
				cur.tokens.push(tok);
			} else if (isInsertInto) {
				cur.tokens.push(tok); // absorb INTO into INSERT clause
			} else if (mergeDepth > 0 && MERGE_BODY_KWS.has(tok.v)) {
				// Inside MERGE body — don't split on UPDATE/INSERT/DELETE/WHEN
				if (cur) cur.tokens.push(tok);
			} else {
				if (cur) clauses.push(cur);
				cur = { type: tok.v, tokens: [] };
				if (tok.v === 'MERGE') mergeDepth++;
			}
		} else if (cur) {
			cur.tokens.push(tok);
			if (tok.t === 'KW' && tok.v === 'BEGIN') beginDepth++;
			else if (tok.t === 'KW' && tok.v === 'END') {
				if (caseDepth > 0) caseDepth--;
				else if (beginDepth > 0) beginDepth--;
			}
		} else {
			cur = { type: '_', tokens: [tok] };
		}
	}
	if (cur) clauses.push(cur);
	return clauses;
}

function extractAlias(tokens) {
	const asIdx = findLastIdx(tokens, t => t.t === 'KW' && t.v === 'AS');
	if (asIdx >= 0 && asIdx === tokens.length - 2) {
		// Missing 3: only strip AS at depth 0 — AS inside CAST(x AS TYPE) must stay
		let depth = 0;
		for (let i = 0; i < asIdx; i++) {
			if (tokens[i].t === 'LP') depth++;
			else if (tokens[i].t === 'RP') depth--;
		}
		if (depth === 0) {
			const aliasToken = tokens[asIdx + 1];
			const alias = (aliasToken.t === 'BID') ? aliasToken.v : `[${aliasToken.v}]`;
			return { expr: tokens.slice(0, asIdx), alias };
		}
	}
	const last = tokens[tokens.length - 1];
	const prev = tokens[tokens.length - 2];
	if ((last?.t === 'BID' || last?.t === 'ID') && prev && prev.t !== 'DOT' && prev.t !== 'LP' && prev.t !== 'KW') {
		return { expr: tokens.slice(0, -1), alias: last.v };
	}
	return { expr: tokens, alias: null };
}

function bracketAlias(raw) {
	if (!raw) return null;
	if (raw.startsWith('[')) return raw;
	return `[${raw}]`;
}

function formatSelectClause(clauseTokens, noColumnNumbers) {
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
	const contPrefix = INDENT + INDENT + ', ';

	const normalLengths = parsed.map((col, idx) => {
		if (col.isMultiLine || col.isLong) return 0;
		const prefix = idx === 0 ? firstPrefix : contPrefix;
		return (prefix + col.mainLine).length;
	});
	const alignAt = normalLengths.reduce((a, b) => (b > a ? b : a), 0);

	const lines = [];
	for (let idx = 0; idx < parsed.length; idx++) {
		const col = parsed[idx];
		const prefix = idx === 0 ? firstPrefix : contPrefix;
		const comment = noColumnNumbers ? '' : ('  ' + colComment(idx));

		// FIX 4: emit standalone leading comments before this column
		if (col.leadingComments?.length) {
			// idx=0: comment goes before SELECT line (no indent); idx>0: INDENT+INDENT
			const cmtIndent = idx === 0 ? '' : (INDENT + INDENT);
			col.leadingComments.forEach(c => lines.push(cmtIndent + c.v));
		}

		if (col.isMultiLine) {
			const adjusted = [...col.lines];
			if (idx === 0) {
				adjusted[0] = adjusted[0].replace(/^\t\t, /, firstPrefix);
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

function hasEmbeddedSubquery(tokens) {
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].t === 'LP' && tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'SELECT') return true;
	}
	return false;
}

// ════════════════════════════════════════════════════════════════════════════
// RULE 19 — SUBQUERY IN FUNCTION ARGS / EXPRESSIONS
// ════════════════════════════════════════════════════════════════════════════

// Check if any arg in a token list contains a subquery: ( SELECT ...
function argHasSubquery(tokens) {
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].t === 'LP' && tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'SELECT') return true;
	}
	return false;
}

// Detect pattern: FUNC_NAME ( ... ) where at least one arg contains a subquery
// Returns { funcName, lpIdx } or null
function detectFuncWithSubqueryArgs(tokens) {
	for (let i = 0; i < tokens.length - 1; i++) {
		const tok = tokens[i];
		// Function name: KW or ID followed by LP
		if ((tok.t === 'KW' || tok.t === 'ID') && tokens[i + 1]?.t === 'LP') {
			const rpIdx = findMatchingParen(tokens, i + 1);
			const argToks = tokens.slice(i + 2, rpIdx);
			if (argHasSubquery(argToks)) {
				return { funcName: tok.v, lpIdx: i + 1, rpIdx };
			}
		}
	}
	return null;
}

// Format a function call whose args may contain subqueries (Rule 19)
// indent = the base indent for the function's opening line
// prefix = what goes before the function name (e.g. '\t\t, ' or '')
// Returns array of lines
function formatFuncWithSubqueryArgs(tokens, baseIndent, prefix) {
	tokens = tokens.filter(t => t.t !== 'NL');

	// Find function name and its LP
	let funcStart = 0;
	// Skip any leading NOT / comparison operators before the func
	while (funcStart < tokens.length &&
		tokens[funcStart].t !== 'KW' && tokens[funcStart].t !== 'ID') funcStart++;

	const funcTok = tokens[funcStart];
	const lpIdx = funcStart + 1;
	if (!funcTok || tokens[lpIdx]?.t !== 'LP') return [prefix + tokStr(tokens)];

	const rpIdx = findMatchingParen(tokens, lpIdx);
	const argTokens = tokens.slice(lpIdx + 1, rpIdx);
	const afterFunc = tokens.slice(rpIdx + 1); // e.g. = 1, > 0 after closing )

	// Tokens before the function name (e.g. nothing, or some prefix expression)
	const beforeFunc = tokens.slice(0, funcStart);
	const beforeStr = beforeFunc.length ? tokStr(beforeFunc) + ' ' : '';

	const argIndent = baseIndent + INDENT;
	const lines = [];

	// Opening line: prefix + beforeStr + FUNCNAME (
	lines.push(prefix + beforeStr + funcTok.v + '(');

	// Split args at depth-0 commas
	const args = splitAtCommas(argTokens);

	args.forEach((argToks, ai) => {
		argToks = argToks.filter(t => t.t !== 'NL');
		const argPrefix = ai === 0 ? argIndent : argIndent + ', ';
		// Remove the leading ', ' if splitAtCommas already stripped commas (it does)
		// ai===0 → argIndent, ai>0 → argIndent + ', ' but comma was already split off
		const linePrefix = ai === 0 ? argIndent : argIndent;

		if (argHasSubquery(argToks)) {
			// Subquery arg: expand it
			// Find the ( SELECT
			let sqStart = -1;
			for (let j = 0; j < argToks.length - 1; j++) {
				if (argToks[j].t === 'LP' && argToks[j+1]?.t === 'KW' && argToks[j+1]?.v === 'SELECT') {
					sqStart = j; break;
				}
			}
			if (sqStart >= 0) {
				const sqEnd = findMatchingParen(argToks, sqStart);
				const beforeSq = argToks.slice(0, sqStart);
				const sqInner = argToks.slice(sqStart + 1, sqEnd);
				const afterSq = argToks.slice(sqEnd + 1);
				const comma = ai > 0 ? ', ' : '';

				if (beforeSq.length) lines.push(linePrefix + comma + tokStr(beforeSq));
				lines.push((beforeSq.length ? argIndent + INDENT : linePrefix + comma) + '(');
				const sqFmt = formatSelectStatement(sqInner, true);
				const sqIndent = beforeSq.length ? argIndent + INDENT + INDENT : argIndent + INDENT;
				sqFmt.split('\n').forEach(l => lines.push(sqIndent + l));
				lines.push((beforeSq.length ? argIndent + INDENT : linePrefix + comma.replace(', ','')) + ')');
				if (afterSq.length) lines.push(argIndent + tokStr(afterSq));
			} else {
				lines.push(linePrefix + (ai > 0 ? ', ' : '') + tokStr(argToks));
			}
		} else {
			// Scalar arg
			lines.push(linePrefix + (ai > 0 ? ', ' : '') + tokStr(argToks));
		}
	});

	// Closing ) of function
	const afterStr = afterFunc.length ? ' ' + tokStr(afterFunc) : '';
	lines.push(baseIndent + ')' + afterStr);

	return lines;
}


function formatColumnWithEmbeddedSubquery(tokens, idx) {
	tokens = tokens.filter(t => t.t !== 'NL');
	const { expr, alias } = extractAlias(tokens);
	const aliasStr = alias ? ' ' + bracketAlias(alias) : '';
	const ind2 = INDENT + INDENT;

	// Rule 19: if the expr is a function call with subquery args, use full arg expansion
	const funcMatch = detectFuncWithSubqueryArgs(expr);
	if (funcMatch) {
		const fmtLines = formatFuncWithSubqueryArgs(expr, ind2 + INDENT, ind2 + ', ');
		// First line: replace leading '\t\t, ' prefix — handled by caller for idx===0
		// Last line gets alias appended
		fmtLines[fmtLines.length - 1] = fmtLines[fmtLines.length - 1].trimEnd() + (aliasStr ? aliasStr : '');
		return { isMultiLine: true, isLong: false, lines: fmtLines };
	}

	// Fallback: single embedded subquery (original logic)
	let sqStart = -1;
	for (let j = 0; j < expr.length - 1; j++) {
		if (expr[j].t === 'LP' && expr[j + 1]?.t === 'KW' && expr[j + 1]?.v === 'SELECT') { sqStart = j; break; }
	}
	if (sqStart < 0) {
		const mainLine = tokStr(expr) + aliasStr;
		return { isMultiLine: false, isLong: true, mainLine };
	}

	const sqEnd      = findMatchingParen(expr, sqStart);
	const beforeToks = expr.slice(0, sqStart);
	const subToks    = expr.slice(sqStart + 1, sqEnd);
	const afterToks  = expr.slice(sqEnd + 1);

	const sqFmt = formatSelectStatement(subToks, true);
	const ind3 = ind2 + INDENT;
	const ind4 = ind2 + INDENT + INDENT;

	const lines = [];
	const lastBefore = beforeToks[beforeToks.length - 1];
	if (lastBefore?.t === 'LP') {
		lines.push(ind2 + ', ' + tokStr(beforeToks.slice(0, -1)) + ' (');
	} else {
		lines.push(ind2 + ', ' + tokStr(beforeToks));
	}
	lines.push(ind3 + '(');
	sqFmt.split('\n').forEach(l => lines.push(ind4 + l));

	const hasClosingRP = afterToks.length > 0 && afterToks[afterToks.length - 1]?.t === 'RP';
	const middleToks   = hasClosingRP ? afterToks.slice(0, -1) : afterToks;
	const middleStr    = middleToks.length ? tokStr(middleToks) : '';

	lines.push(ind3 + ')' + middleStr);
	lines.push(ind2 + (hasClosingRP ? ')' : '') + aliasStr);

	return { isMultiLine: true, isLong: false, lines };
}

// ── OVER clause expansion (Rule 20) ──
function shouldExpandOver(overInnerTokens) {
	// Expand if: has PARTITION BY, OR has ROWS/RANGE BETWEEN, OR is long
	const inner = tokStr(overInnerTokens);
	return inner.length > 40 ||
		overInnerTokens.some(t => t.v === 'PARTITION') ||
		overInnerTokens.some(t => t.v === 'ROWS' || t.v === 'RANGE');
}

function formatOverClause(funcStr, overInnerTokens, baseIndent) {
	// funcStr  = 'ROW_NUMBER()' or 'SUM(Salary)'
	// overInnerTokens = tokens inside OVER(...)
	// baseIndent = indent for the closing )
	const innerIndent = baseIndent + INDENT + INDENT;

	// Split OVER contents at PARTITION/ORDER/ROWS/RANGE keywords
	const lines = [funcStr + ' OVER ('];

	const parts = splitAtTopKws(
		overInnerTokens.filter(t => t.t !== 'NL'),
		new Set(['PARTITION', 'ORDER', 'ROWS', 'RANGE'])
	).filter(p => p.tokens.length > 0 || p.kw);

	parts.forEach(({ kw, tokens: pt }) => {
		if (!kw && !pt.length) return;
		if (kw === 'PARTITION') {
			// PARTITION BY col1, col2
			const byIdx = pt.findIndex(t => t.v === 'BY');
			const colToks = byIdx >= 0 ? pt.slice(byIdx + 1) : pt;
			const cols = splitAtCommas(colToks);
			lines.push(innerIndent + 'PARTITION BY ' + cols.map(c => tokStr(c)).join(', '));
		} else if (kw === 'ORDER') {
			const byIdx = pt.findIndex(t => t.v === 'BY');
			const colToks = byIdx >= 0 ? pt.slice(byIdx + 1) : pt;
			const cols = splitAtCommas(colToks);
			lines.push(innerIndent + 'ORDER BY ' + cols.map(c => tokStr(c)).join(', '));
		} else if (kw === 'ROWS' || kw === 'RANGE') {
			lines.push(innerIndent + kw + ' ' + tokStr(pt));
		} else if (pt.length) {
			lines.push(innerIndent + tokStr(pt));
		}
	});

	lines.push(baseIndent + INDENT + ')');
	return lines.join('\n');
}

function parseSelectColumn(tokens, idx) {
	tokens = tokens.filter(t => t.t !== 'NL');
	// FIX 4: Extract LEADING standalone comments before the column expression
	const leadingComments = [];
	while (tokens.length && tokens[0].t === 'COMMENT') leadingComments.push(tokens.shift());
	// Strip trailing source comments — formatter adds its own
	while (tokens.length && tokens[tokens.length - 1].t === 'COMMENT') tokens = tokens.slice(0, -1);

	const wrapComments = result => ({ ...result, leadingComments });

	if (tokens[0]?.t === 'KW' && tokens[0]?.v === 'CASE') return wrapComments(formatCaseColumn(tokens, idx, false));
	if (tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'CASE') return wrapComments(formatCaseColumn(tokens, idx, true));
	if (tokens[0]?.t === 'LP' && tokens[1]?.t === 'KW' && tokens[1]?.v === 'SELECT') return wrapComments(formatSubqueryColumn(tokens, idx));

	const hasOver = tokens.some(t => t.t === 'KW' && t.v === 'OVER');
	const { expr, alias } = extractAlias(tokens);

	if (hasEmbeddedSubquery(expr)) return wrapComments(formatColumnWithEmbeddedSubquery(tokens, idx));

	const exprStr = tokStr(expr);
	const aliasStr = alias ? bracketAlias(alias) : null;
	const mainLine = aliasStr ? exprStr + ' ' + aliasStr : exprStr;

	// Rule 20: expand OVER clause when it has PARTITION BY, ROWS/RANGE, or is long
	if (hasOver) {
		const overIdx = expr.findIndex(t => t.t === 'KW' && t.v === 'OVER');
		if (overIdx >= 0 && expr[overIdx + 1]?.t === 'LP') {
			const overEnd = findMatchingParen(expr, overIdx + 1);
			const overInner = expr.slice(overIdx + 2, overEnd);
			if (shouldExpandOver(overInner)) {
				const funcStr = tokStr(expr.slice(0, overIdx));
				const aliasStr2 = alias ? ' ' + bracketAlias(alias) : '';
				const ind2 = INDENT + INDENT;
				const overLines = formatOverClause(funcStr, overInner, ind2).split('\n');
				const colLines = [ind2 + ', ' + overLines[0], ...overLines.slice(1)];
				colLines[colLines.length - 1] += aliasStr2;
				return wrapComments({ isMultiLine: true, isLong: false, lines: colLines });
			}
		}
	}

	const isLong = hasOver || mainLine.length > MAX_INLINE_COL_LEN || tokens.some(t => LONG_COL_KWS.has(t.v));

	return wrapComments({ isMultiLine: false, isLong, mainLine });
}

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
		const endIdx = findLastIdx(tokens, t => t.v === 'END');
		if (endIdx >= 0) {
			const rest = tokens.slice(endIdx + 1).filter(t => !(t.t === 'KW' && t.v === 'AS'));
			if (rest.length) alias = rest[rest.length - 1].v;
			caseTokens = tokens.slice(0, endIdx + 1);
		}
	}

	const aliasStr = alias ? bracketAlias(alias) : '';
	const lines = [];
	lines.push(INDENT + INDENT + ', (');
	lines.push(...emitCaseLines(caseTokens, INDENT + INDENT + INDENT));
	lines.push(INDENT + INDENT + ') ' + aliasStr);
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
			// Rule 19: subquery in WHEN condition — expand it
			if (hasEmbeddedSubquery(whenToks) && detectFuncWithSubqueryArgs(whenToks)) {
				const whenLines = formatFuncWithSubqueryArgs(whenToks, indent + INDENT + INDENT, indent + INDENT + 'WHEN ');
				lines.push(...whenLines);
			} else {
				lines.push(indent + INDENT + 'WHEN ' + tokStr(whenToks));
			}
			if (tokens[i]?.v === 'THEN') i++;
			const thenToks = [];
			// Peek: is the THEN value a nested CASE?
			const thenIsCase = tokens[i]?.v === 'CASE';
			while (i < tokens.length && !['WHEN','ELSE','END'].includes(tokens[i].v)) {
				if (tokens[i].v === 'CASE') {
					const cnt = collectCaseBlock(tokens, i);
					// Rule 10: emit THEN on its own line, then nested CASE indented one more level
					lines.push(indent + INDENT + INDENT + 'THEN');
					lines.push(...emitCaseLines(tokens.slice(i, i + cnt), indent + INDENT + INDENT + INDENT));
					i += cnt;
				} else { thenToks.push(tokens[i++]); }
			}
			if (thenToks.length) lines.push(indent + INDENT + INDENT + 'THEN ' + tokStr(thenToks));
		} else if (tok.v === 'ELSE') {
			i++;
			// Rule 10: if ELSE value is a nested CASE, expand it
			if (tokens[i]?.v === 'CASE') {
				const cnt = collectCaseBlock(tokens, i);
				lines.push(indent + INDENT + 'ELSE');
				lines.push(...emitCaseLines(tokens.slice(i, i + cnt), indent + INDENT + INDENT));
				i += cnt;
			} else {
				const elseToks = [];
				while (i < tokens.length && tokens[i].v !== 'END') elseToks.push(tokens[i++]);
				lines.push(indent + INDENT + 'ELSE ' + tokStr(elseToks));
			}
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
	lines.push(INDENT + INDENT + ', (');
	innerFormatted.split('\n').forEach(l => lines.push(INDENT + INDENT + INDENT + l));
	lines.push(INDENT + INDENT + ') ' + aliasStr);
	return { isMultiLine: true, isLong: false, lines };
}

const JOIN_START_KWS = new Set(['JOIN','INNER','LEFT','RIGHT','FULL','CROSS','OUTER','APPLY']);

const CMP_OPS = new Set(['=', '<>', '!=', '>', '>=', '<', '<=']);

function flipCmpOp(op) {
	switch (op) {
		case '>':  return '<';
		case '<':  return '>';
		case '>=': return '<=';
		case '<=': return '>=';
		default:   return op;
	}
}

function bareId(s) { return s.replace(/^\[|\]$/g, '').toLowerCase(); }

function getJoinTableName(tableToks) {
	tableToks = tableToks.filter(t => t.t !== 'NL');
	const withIdx = tableToks.findIndex(t => t.t === 'KW' && t.v === 'WITH');
	const mainToks = withIdx >= 0 ? tableToks.slice(0, withIdx) : tableToks;
	const { expr, alias } = extractAlias(mainToks);
	if (alias) return bareId(alias);
	for (let i = expr.length - 1; i >= 0; i--) {
		if (expr[i].t === 'ID' || expr[i].t === 'BID') return bareId(expr[i].v);
	}
	return null;
}

function tableRefOnSide(tokens) {
	for (let i = 0; i < tokens.length - 1; i++) {
		if ((tokens[i].t === 'ID' || tokens[i].t === 'BID') && tokens[i + 1]?.t === 'DOT') {
			return bareId(tokens[i].v);
		}
	}
	return null;
}

function reorderOnCondition(condToks, joinedTable) {
	let opIdx = -1, depth = 0;
	for (let i = 0; i < condToks.length; i++) {
		if (condToks[i].t === 'LP') { depth++; continue; }
		if (condToks[i].t === 'RP') { depth--; continue; }
		if (depth === 0 && condToks[i].t === 'OP' && CMP_OPS.has(condToks[i].v)) { opIdx = i; break; }
	}
	if (opIdx < 0) return condToks;

	const leftToks  = condToks.slice(0, opIdx);
	const op        = condToks[opIdx].v;
	const rightToks = condToks.slice(opIdx + 1);

	const leftRef  = tableRefOnSide(leftToks);
	const rightRef = tableRefOnSide(rightToks);

	if (rightRef === joinedTable && leftRef !== joinedTable) {
		return [...rightToks, { t: 'OP', v: flipCmpOp(op) }, ...leftToks];
	}
	return condToks;
}

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

		lines.push(INDENT + INDENT + block.joinType + ' ' + formatTableRef(tableToks));

		if (onToks.length) {
			const joinedTable = getJoinTableName(tableToks);
			const conditions = splitAtTopKws(onToks, new Set(['AND', 'OR']));
			conditions.forEach(({ kw, tokens: ct }, ci) => {
				if (!ct.length) return;
				const ordered = (REORDER_JOIN_ON && joinedTable) ? reorderOnCondition(ct, joinedTable) : ct;
				lines.push(ci === 0
					? INDENT + INDENT + INDENT + 'ON' + INDENT + tokStr(ordered)
					: INDENT + INDENT + INDENT + kw + INDENT + tokStr(ordered));
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
				JOIN_START_KWS.has(tokens[i].v)) {
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
		return '(\n' + innerFmt.split('\n').map(l => INDENT + INDENT + INDENT + INDENT + l).join('\n') + '\n' + INDENT + INDENT + ')' + alias;
	}

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

	const noSchema = !tableStr.includes('.');
	const notSpecial = !/^[@#]/.test(tableStr);
	const notFn = !expr.some(t => t.t === 'LP');
	const notTVF = !TVF_NAMES.has(tableStr.toUpperCase());
	const notKw = !KEYWORDS.has(tableStr.toUpperCase()) || DATATYPES.has(tableStr.toUpperCase());
	const notCTE = !_cteNames.has(tableStr.toLowerCase());
	if (noSchema && notSpecial && notFn && notTVF && notKw && notCTE) tableStr = 'dbo.' + tableStr;

	const aliasPart = alias ? ' ' + bracketAlias(alias) : '';
	return tableStr + aliasPart + hintStr;
}

function isFullParenGroup(tokens) {
	return tokens.length > 0 && tokens[0]?.t === 'LP' && findMatchingParen(tokens, 0) === tokens.length - 1;
}

function formatConditionBlock(innerTokens, indent) {
	const segs = splitAtTopKws(innerTokens.filter(t => t.t !== 'NL'), new Set(['AND', 'OR']))
		.filter(s => s.tokens.length > 0);
	const lines = [indent + '('];

	segs.forEach(({ kw, tokens: gt }, i) => {
		if (i > 0) {
			let kwLine = indent + INDENT + kw;
			let j = 0;
			while (j < gt.length && gt[j].t === 'COMMENT') { kwLine += ' ' + gt[j].v; j++; }
			lines.push(kwLine);
			gt = gt.slice(j);
		}
		if (!gt.length) return;

		if (isFullParenGroup(gt)) {
			const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
			lines.push(...formatConditionBlock(inner, indent + INDENT));
		} else {
			formatConditionGroup(gt).forEach(cl => lines.push(indent + INDENT + cl));
		}
	});

	lines.push(indent + ')');
	return lines;
}

function expandWhereSegs(validSegs) {
	const out = [];
	for (const { kw, tokens: gt } of validSegs) {
		if (isFullParenGroup(gt)) {
			const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
			const innerSegs = splitAtTopKws(inner, new Set(['AND', 'OR'])).filter(s => s.tokens.length > 0);
			if (innerSegs.length > 1) {
				out.push({ kw, tokens: innerSegs[0].tokens });
				for (let j = 1; j < innerSegs.length; j++) out.push(innerSegs[j]);
				continue;
			}
		}
		out.push({ kw, tokens: gt });
	}
	return out;
}

function formatWhereClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const raw = splitAtTopKws(clauseTokens, new Set(['AND', 'OR'])).filter(s => s.tokens.length > 0);
	if (!raw.length) return 'WHERE';
	const expanded = expandWhereSegs(raw);
	const lines = [];

	if (expanded.length === 1) {
		const { tokens: gt } = expanded[0];
		let condToks = gt;
		if (isFullParenGroup(gt)) {
			const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
			const innerSegs = splitAtTopKws(inner, new Set(['AND', 'OR'])).filter(s => s.tokens.length > 0);
			if (innerSegs.length > 1) {
				lines.push('WHERE');
				lines.push(...formatConditionBlock(inner, INDENT));
				return lines.join('\n');
			}
			condToks = inner;
		}
		const condLines = formatConditionGroup(condToks);
		lines.push('WHERE' + INDENT + condLines[0]);
		condLines.slice(1).forEach(cl => lines.push(INDENT + INDENT + cl));
		return lines.join('\n');
	}

	const anyParen = expanded.some(({ tokens: gt }) => isFullParenGroup(gt));

	if (!anyParen) {
		lines.push('WHERE' + INDENT + '(');
		expanded.forEach(({ kw, tokens: gt }, i) => {
			const condLines = formatConditionGroup(gt);
			const leader = i === 0 ? '' : kw + ' ';
			lines.push(INDENT + INDENT + leader + condLines[0]);
			condLines.slice(1).forEach(cl => lines.push(INDENT + INDENT + cl));
		});
		lines.push(INDENT + ')');
	} else {
		// FIX #3 & #4: AND/OR between groups at 2 tabs, ( at 2 tabs
		lines.push('WHERE');
		expanded.forEach(({ kw, tokens: gt }, i) => {
			if (i > 0) lines.push(INDENT + INDENT + kw);          // FIX #3: was INDENT + kw
			if (isFullParenGroup(gt)) {
				const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
				lines.push(...formatConditionBlock(inner, INDENT + INDENT));  // FIX #4: was INDENT
			} else {
				const condLines = formatConditionGroup(gt);
				lines.push(INDENT + INDENT + '(');                 // FIX #4: was INDENT + '('
				condLines.forEach(cl => lines.push(INDENT + INDENT + INDENT + cl));
				lines.push(INDENT + INDENT + ')');
			}
		});
	}

	return lines.join('\n');
}

function formatConditionGroup(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL');
	if (!tokens.length) return [];

	if (tokens[0]?.t === 'LP' && findMatchingParen(tokens, 0) === tokens.length - 1) {
		tokens = tokens.slice(1, -1);
	}

	const firstKw = tokens[0]?.v;
	if (firstKw === 'EXISTS' || (firstKw === 'NOT' && tokens[1]?.v === 'EXISTS')) {
		const isNot = firstKw === 'NOT';
		const prefix = isNot ? 'NOT EXISTS' : 'EXISTS';
		const skip = isNot ? 2 : 1;
		if (tokens[skip]?.t === 'LP') {
			const parenEnd = findMatchingParen(tokens, skip);
			const inner = tokens.slice(skip + 1, parenEnd);
			const innerFmt = formatSelectStatement(inner, true);
			return [prefix + ' (', ...innerFmt.split('\n').map(l => INDENT + l), ')'];
		}
	}

	const notIdx = tokens.findIndex(t => t.v === 'NOT');
	const inIdx = tokens.findIndex(t => t.t === 'KW' && t.v === 'IN');
	let nextAfterNot = notIdx + 1;
	while (nextAfterNot < tokens.length && tokens[nextAfterNot].t === 'COMMENT') nextAfterNot++;
	const effectiveNotIn = (notIdx >= 0 && tokens[nextAfterNot]?.v === 'IN') ? notIdx : -1;
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
				return [colStr + ' ' + inOp + ' (', ...inner.split('\n').map(l => INDENT + l), ')'];
			}
			const items = splitAtCommas(listToks);
			if (items.length >= IN_LIST_BREAK_AT) {
				const out = [colStr + ' ' + inOp + ' ('];
				items.forEach((it, ii) => out.push((ii === 0 ? INDENT + INDENT : INDENT + INDENT + ', ') + tokStr(it)));
				out.push(')');
				return out;
			}
		}
	}

	// Rule 19: function call with embedded subquery in WHERE/HAVING condition
	// formatFuncWithSubqueryArgs returns lines with built-in indentation relative to baseIndent.
	// Return as a single "line" that the caller won't double-indent by joining with \n
	// and wrapping in a special format the caller can detect.
	// Simplest correct approach: use baseIndent='' so lines are unindented,
	// the caller (formatConditionBlock / formatWhereClause) will prepend INDENT+INDENT normally.
	// Internal structure uses INDENT for each nesting level relative to ''.
	if (detectFuncWithSubqueryArgs(tokens)) {
		return formatFuncWithSubqueryArgs(tokens, '', '');
	}

	return [tokStr(tokens)];
}

function formatGroupByClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const toks = clauseTokens[0]?.v === 'BY' ? clauseTokens.slice(1) : clauseTokens;
	const cols = splitAtCommas(toks);
	const lines = ['GROUP BY'];
	cols.forEach((ct, i) => lines.push((i === 0 ? INDENT + INDENT : INDENT + INDENT + ', ') + tokStr(ct)));
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
	cols.forEach((ct, i) => lines.push((i === 0 ? INDENT + INDENT : INDENT + INDENT + ', ') + tokStr(ct)));
	// FIX #5: OFFSET/FETCH at no extra indentation — same level as ORDER BY (no tabs)
	if (pagToks.length) {
		const fetchIdx = pagToks.findIndex(t => t.v === 'FETCH');
		if (fetchIdx >= 0) {
			lines.push(tokStr(pagToks.slice(0, fetchIdx)));         // FIX #5: no INDENT+INDENT
			lines.push(tokStr(pagToks.slice(fetchIdx)));
		} else {
			lines.push(tokStr(pagToks));
		}
	}
	return lines.join('\n');
}

function formatHavingClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const raw = splitAtTopKws(clauseTokens, new Set(['AND', 'OR'])).filter(s => s.tokens.length > 0);
	if (!raw.length) return 'HAVING';
	const expanded = expandWhereSegs(raw);
	const lines = [];

	if (expanded.length === 1) {
		const { tokens: gt } = expanded[0];
		let condToks = gt;
		if (isFullParenGroup(gt)) {
			const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
			const innerSegs = splitAtTopKws(inner, new Set(['AND', 'OR'])).filter(s => s.tokens.length > 0);
			if (innerSegs.length > 1) {
				lines.push('HAVING');
				lines.push(...formatConditionBlock(inner, INDENT));
				return lines.join('\n');
			}
			condToks = inner;
		}
		const condLines = formatConditionGroup(condToks);
		lines.push('HAVING' + INDENT + condLines[0]);
		condLines.slice(1).forEach(cl => lines.push(INDENT + INDENT + cl));
		return lines.join('\n');
	}

	const anyParen = expanded.some(({ tokens: gt }) => isFullParenGroup(gt));

	if (!anyParen) {
		lines.push('HAVING' + INDENT + '(');
		expanded.forEach(({ kw, tokens: gt }, i) => {
			const condLines = formatConditionGroup(gt);
			const leader = i === 0 ? '' : kw + ' ';
			lines.push(INDENT + INDENT + leader + condLines[0]);
			condLines.slice(1).forEach(cl => lines.push(INDENT + INDENT + cl));
		});
		lines.push(INDENT + ')');
	} else {
		lines.push('HAVING');
		expanded.forEach(({ kw, tokens: gt }, i) => {
			if (i > 0) lines.push(INDENT + INDENT + kw);
			if (isFullParenGroup(gt)) {
				const inner = gt.slice(1, -1).filter(t => t.t !== 'NL');
				lines.push(...formatConditionBlock(inner, INDENT + INDENT));
			} else {
				const condLines = formatConditionGroup(gt);
				lines.push(INDENT + INDENT + '(');
				condLines.forEach(cl => lines.push(INDENT + INDENT + INDENT + cl));
				lines.push(INDENT + INDENT + ')');
			}
		});
	}

	return lines.join('\n');
}

// Dispatcher for CREATE — routes TABLE to the column formatter, others passthrough
function formatCreateClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const first = clauseTokens[0];
	if ((first?.t === 'DT' || first?.t === 'KW') && first?.v === 'TABLE') {
		return formatCreateTableClause(clauseTokens);
	}
	// CREATE PROCEDURE handled by formatProcStatement at batch level
	// Everything else — passthrough
	return 'CREATE ' + tokStr(clauseTokens);
}

// ── Missing 1: CREATE TABLE column list formatting ──
function formatCreateTableClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	// clauseTokens = TABLE dbo.tabName (col defs...)
	// or just dbo.tabName (col defs...)
	let i = 0;

	// Skip TABLE keyword if present (comes through as DT token)
	if (clauseTokens[i]?.t === 'DT' && clauseTokens[i]?.v === 'TABLE') i++;

	// Collect table name (up to LP)
	const nameToks = [];
	while (i < clauseTokens.length && clauseTokens[i].t !== 'LP') {
		nameToks.push(clauseTokens[i++]);
	}
	let tableName = tokStr(nameToks).trim();
	if (tableName && !tableName.includes('.') && !/^[@#]/.test(tableName)) {
		tableName = 'dbo.' + tableName;
	}

	if (clauseTokens[i]?.t !== 'LP') return 'CREATE TABLE ' + tableName;

	const parenEnd = findMatchingParen(clauseTokens, i);
	const colToks = clauseTokens.slice(i + 1, parenEnd);
	const cols = splitAtCommas(colToks);

	const lines = ['CREATE TABLE ' + tableName];
	lines.push('(');
	cols.forEach((ct, ci) => {
		lines.push(INDENT + (ci === 0 ? '  ' : ', ') + tokStr(ct).trim());
	});
	lines.push(')');
	return lines.join('\n');
}

// ── Missing 2: DECLARE @t TABLE column list ──
function formatDeclareTableVar(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL' && !(t.t === 'KW' && t.v === 'AS'));
	// clauseTokens = @VarName TABLE (col1 TYPE, col2 TYPE, ...)
	let i = 0;
	const varTok = clauseTokens[i++]; // @VarName
	// Skip TABLE keyword
	if (clauseTokens[i]?.v === 'TABLE' || clauseTokens[i]?.t === 'DT') i++;

	if (clauseTokens[i]?.t !== 'LP') {
		return 'DECLARE ' + tokStr(clauseTokens);
	}

	const parenEnd = findMatchingParen(clauseTokens, i);
	const colToks = clauseTokens.slice(i + 1, parenEnd);
	const cols = splitAtCommas(colToks);

	const lines = ['DECLARE ' + varTok.v + ' TABLE'];
	lines.push('(');
	cols.forEach((ct, ci) => {
		lines.push(INDENT + (ci === 0 ? '  ' : ', ') + tokStr(ct).trim());
	});
	lines.push(')');
	return lines.join('\n');
}

function formatDeclareClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	// Missing 2: DECLARE @Var TABLE (col list) — format column list
	if (clauseTokens[0]?.t === 'VAR') {
		let j = 1;
		if (clauseTokens[j]?.t === 'KW' && clauseTokens[j]?.v === 'AS') j++;
		if (clauseTokens[j]?.v === 'TABLE' && clauseTokens[j + 1]?.t === 'LP') {
			return formatDeclareTableVar(clauseTokens);
		}
	}
	// FIX #2: Remove AS keyword from DECLARE — Rule 3 strictly forbids AS in DECLARE
	clauseTokens = clauseTokens.filter(t => !(t.t === 'KW' && t.v === 'AS'));
	return 'DECLARE ' + tokStr(clauseTokens);
}

// Dispatch SET to proc-style or UPDATE-style based on first token
function formatSetDispatch(clauseTokens) {
	const filtered = clauseTokens.filter(t => t.t !== 'NL');
	const first = filtered[0];
	// Proc SET: starts with @variable
	// UPDATE SET: starts with column name (ID or BID), no leading @
	if (first?.t === 'VAR') return formatSetClause(filtered);
	// Check for multiple assignments (comma at depth 0 = UPDATE SET)
	const assignments = splitAtCommas(filtered);
	if (assignments.length > 1) return formatUpdateSetClause(filtered);
	// Single col = val without @ — still UPDATE SET style
	if (first?.t === 'ID' || first?.t === 'BID') return formatUpdateSetClause(filtered);
	return formatSetClause(filtered);
}

function formatSetClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const eqIdx = clauseTokens.findIndex(t => t.t === 'OP' && t.v === '=');
	if (eqIdx >= 0) {
		const lhs = tokStr(clauseTokens.slice(0, eqIdx));
		let rhs = clauseTokens.slice(eqIdx + 1);

		// FIX #6: Do NOT strip outer parens — Rule 15 shows SET @Var = (\n CASE...\n)
		// Only strip if it's NOT a CASE or SELECT inside
		const rhsInner = (rhs[0]?.t === 'LP' && findMatchingParen(rhs, 0) === rhs.length - 1)
			? rhs.slice(1, -1)
			: null;

		const innerContent = rhsInner || rhs;

		if (innerContent[0]?.v === 'CASE') {
			const caseLines = emitCaseLines(innerContent, INDENT);
			return ['SET ' + lhs + ' = (', ...caseLines, ')'].join('\n');
		}
		if (innerContent[0]?.v === 'SELECT') {
			const inner = formatSelectStatement(innerContent, true);
			return ['SET ' + lhs + ' = (', ...inner.split('\n').map(l => INDENT + l), ')'].join('\n');
		}
	}

	if (clauseTokens.some(t => t.t === 'COMMENT')) {
		const main     = clauseTokens.filter(t => t.t !== 'COMMENT');
		const comments = clauseTokens.filter(t => t.t === 'COMMENT').map(t => t.v).join(' ');
		return 'SET ' + tokStr(main) + ' ' + comments;
	}

	return 'SET ' + tokStr(clauseTokens);
}

function formatIfClause(clauseTokens, indent, keyword = 'IF') {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const lines = [];
	let i = 0;

	const condToks = [];
	while (i < clauseTokens.length && clauseTokens[i]?.v !== 'BEGIN') {
		condToks.push(clauseTokens[i++]);
	}
	lines.push(keyword + ' ' + tokStr(condToks));

	if (clauseTokens[i]?.v === 'BEGIN') {
		i++;
		lines.push('BEGIN');
		lines.push('');

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

		formatProcBody(bodyToks, indent + INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END');
	}

	if (i < clauseTokens.length && clauseTokens[i]?.v === 'ELSE') {
		i++;
		if (clauseTokens[i]?.v === 'IF') {
			i++;
			formatIfClause(clauseTokens.slice(i), indent, 'ELSE IF').split('\n').forEach(l => lines.push(l));
		} else {
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
				formatProcBody(elseToks, indent + INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
				lines.push('');
				lines.push('END');
			}
		}
	}

	return lines.join('\n');
}

function formatWhileClause(clauseTokens, indent) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const lines = [];
	let i = 0;

	const condToks = [];
	while (i < clauseTokens.length && clauseTokens[i]?.v !== 'BEGIN') {
		condToks.push(clauseTokens[i++]);
	}
	lines.push('WHILE ' + tokStr(condToks));

	if (clauseTokens[i]?.v === 'BEGIN') {
		i++;
		lines.push('BEGIN');
		lines.push('');
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
		formatProcBody(bodyToks, indent + INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END');
	}

	return lines.join('\n');
}

// ── FIX 5: TRY/CATCH extractor ──
function extractTryCatch(tokens) {
	// Find BEGIN TRY at depth 0
	let tryStart = -1;
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].t === 'KW' && tokens[i].v === 'BEGIN' &&
			tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'TRY') {
			tryStart = i; break;
		}
	}
	if (tryStart < 0) return null;

	const before = tokens.slice(0, tryStart);
	let i = tryStart + 2; // skip BEGIN TRY

	// Collect TRY body until END TRY
	const tryBody = [];
	let depth = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		if (t.t === 'KW' && t.v === 'BEGIN') depth++;
		if (t.t === 'KW' && t.v === 'END') {
			if (depth > 0) { depth--; tryBody.push(t); i++; continue; }
			// depth 0 END — check if followed by TRY
			if (tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'TRY') { i += 2; break; }
		}
		tryBody.push(t); i++;
	}

	// Expect BEGIN CATCH
	if (!(tokens[i]?.t === 'KW' && tokens[i]?.v === 'BEGIN' &&
		  tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'CATCH')) return null;
	i += 2; // skip BEGIN CATCH

	// Collect CATCH body until END CATCH
	const catchBody = [];
	depth = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		if (t.t === 'KW' && t.v === 'BEGIN') depth++;
		if (t.t === 'KW' && t.v === 'END') {
			if (depth > 0) { depth--; catchBody.push(t); i++; continue; }
			if (tokens[i + 1]?.t === 'KW' && tokens[i + 1]?.v === 'CATCH') { i += 2; break; }
		}
		catchBody.push(t); i++;
	}

	const after = tokens.slice(i);
	return { before, tryBody, catchBody, after };
}

function formatProcBody(tokens, indent = INDENT) {
	tokens = tokens.filter(t => t.t !== 'NL');

	// ── FIX 5: Handle BEGIN TRY...END TRY BEGIN CATCH...END CATCH ──
	// Scan for BEGIN TRY at depth 0 and extract the blocks before clause splitting
	const tryResult = extractTryCatch(tokens);
	if (tryResult) {
		const lines = [];
		// Format any statements before BEGIN TRY
		if (tryResult.before.length) {
			formatProcBody(tryResult.before, indent).forEach(l => lines.push(l));
			if (lines.length && lines[lines.length - 1] !== '') lines.push('');
		}
		lines.push('BEGIN TRY');
		lines.push('');
		formatProcBody(tryResult.tryBody, indent + INDENT).forEach(l =>
			lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END TRY');
		lines.push('BEGIN CATCH');
		lines.push('');
		formatProcBody(tryResult.catchBody, indent + INDENT).forEach(l =>
			lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END CATCH');
		// Format any statements after END CATCH
		if (tryResult.after.length) {
			lines.push('');
			formatProcBody(tryResult.after, indent).forEach(l => lines.push(l));
		}
		// Trim trailing blanks + add rule-16 blank before END
		while (lines.length && lines[lines.length - 1] === '') lines.pop();
		lines.push('');
		return lines;
	}

	let clauses = splitIntoClauses(tokens);
	clauses = mergeDeleteClauses(clauses);
	const lines = [];

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
		if (c.type === 'WHILE') {
			const fmt = formatWhileClause(c.tokens, indent);
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

	// FIX #7: Don't trim ALL trailing blanks — preserve exactly 1 blank line before END
	// Remove all trailing blanks first, then add exactly one back
	while (lines.length && lines[lines.length - 1] === '') lines.pop();
	lines.push(''); // Rule 16: blank line before END
	return lines;
}

// ── FIX 1: SELECT INTO #TempTable ──
function formatIntoClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	if (!clauseTokens.length) return 'INTO';
	// clauseTokens = #TempTable or @TableVar
	return 'INTO\t' + tokStr(clauseTokens);
}

// ── FIX 7: MERGE statement ──
function formatMergeClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const lines = [];
	let i = 0;

	// Collect target table (up to USING)
	const targetToks = [];
	while (i < clauseTokens.length && clauseTokens[i].v !== 'USING') {
		targetToks.push(clauseTokens[i++]);
	}
	lines.push('MERGE ' + formatTableRef(targetToks));

	if (clauseTokens[i]?.v === 'USING') i++;

	// Collect source table (up to ON)
	const sourceToks = [];
	while (i < clauseTokens.length && clauseTokens[i].v !== 'ON') {
		sourceToks.push(clauseTokens[i++]);
	}
	lines.push('USING ' + formatTableRef(sourceToks));

	if (clauseTokens[i]?.v === 'ON') i++;

	// Collect ON condition (up to first WHEN)
	const onToks = [];
	while (i < clauseTokens.length && clauseTokens[i].v !== 'WHEN') {
		onToks.push(clauseTokens[i++]);
	}
	const onConds = splitAtTopKws(onToks, new Set(['AND', 'OR']));
	onConds.forEach(({ kw, tokens: ct }, ci) => {
		if (!ct.length) return;
		lines.push(ci === 0
			? INDENT + 'ON' + INDENT + tokStr(ct)
			: INDENT + kw + INDENT + tokStr(ct));
	});

	// Parse WHEN ... THEN ... blocks
	while (i < clauseTokens.length && (clauseTokens[i]?.v === 'WHEN')) {
		i++; // skip WHEN
		// Collect WHEN condition (NOT MATCHED / MATCHED [AND ...])
		const whenToks = [];
		while (i < clauseTokens.length && clauseTokens[i]?.v !== 'THEN') {
			whenToks.push(clauseTokens[i++]);
		}
		lines.push('WHEN ' + tokStr(whenToks));
		if (clauseTokens[i]?.v === 'THEN') i++;

		// Determine action: UPDATE SET / INSERT / DELETE
		const actionKw = clauseTokens[i]?.v;
		if (actionKw === 'UPDATE') {
			i++;
			if (clauseTokens[i]?.v === 'SET') i++;
			// Collect SET assignments until WHEN/semicolon/end
			const setToks = [];
			while (i < clauseTokens.length && clauseTokens[i]?.v !== 'WHEN') {
				setToks.push(clauseTokens[i++]);
			}
			const assignments = splitAtCommas(setToks);
			lines.push(INDENT + 'THEN UPDATE SET');
			assignments.forEach((a, ai) => {
				lines.push(INDENT + INDENT + (ai === 0 ? '  ' : ', ') + tokStr(a));
			});
		} else if (actionKw === 'INSERT') {
			i++;
			// Optional column list
			let colList = '';
			if (clauseTokens[i]?.t === 'LP') {
				const colEnd = findMatchingParen(clauseTokens, i);
				const colToks = clauseTokens.slice(i + 1, colEnd);
				colList = '(' + splitAtCommas(colToks).map(c => tokStr(c)).join(', ') + ')';
				i = colEnd + 1;
			}
			lines.push(INDENT + 'THEN INSERT ' + colList);
			// VALUES
			if (clauseTokens[i]?.v === 'VALUES') {
				i++;
				if (clauseTokens[i]?.t === 'LP') {
					const valEnd = findMatchingParen(clauseTokens, i);
					const valToks = clauseTokens.slice(i + 1, valEnd);
					const vals = splitAtCommas(valToks);
					lines.push(INDENT + INDENT + '  VALUES (');
					vals.forEach((v, vi) => {
						lines.push(INDENT + INDENT + INDENT + (vi === 0 ? '  ' : ', ') + tokStr(v));
					});
					lines.push(INDENT + INDENT + '  )');
					i = valEnd + 1;
				}
			}
		} else if (actionKw === 'DELETE') {
			i++;
			lines.push(INDENT + 'THEN DELETE');
		}
	}

	// Optional OUTPUT clause
	if (clauseTokens[i]?.v === 'OUTPUT') {
		lines.push('');
		const outToks = [];
		i++;
		while (i < clauseTokens.length) outToks.push(clauseTokens[i++]);
		lines.push('OUTPUT ' + tokStr(outToks));
	}

	lines.push(';');
	return lines.join('\n');
}

// ── FIX 6: UPDATE + UPDATE SET ──
function formatUpdateClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	if (!clauseTokens.length) return 'UPDATE';
	// clauseTokens = table ref (everything before SET/FROM/WHERE which are separate clauses)
	const tableStr = formatTableRef(clauseTokens);
	return 'UPDATE ' + tableStr;
}

function formatUpdateSetClause(clauseTokens) {
	// Called when SET appears after UPDATE (not a proc variable SET)
	// clauseTokens = col1 = val1, col2 = val2, ...
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	const assignments = splitAtCommas(clauseTokens);
	// Always one assignment per line with tab alignment
	const lines = ['SET\t' + tokStr(assignments[0])];
	assignments.slice(1).forEach(a => lines.push('\t\t, ' + tokStr(a)));
	return lines.join('\n');
}

// ── FIX 8: DELETE FROM ──
function formatDeleteClause(clauseTokens) {
	// clauseTokens = the FROM clause tokens (table ref + optional joins/where absorbed by mergeDeleteClauses)
	// clauseTokens may also have a leading alias for DELETE t FROM tabX style
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	if (!clauseTokens.length) return 'DELETE FROM';

	// Handle DELETE [alias] FROM table style — if first token is ID before FROM keyword
	let deleteAlias = '';
	let i = 0;
	if (clauseTokens[i]?.t !== 'KW' && clauseTokens[i]?.t !== 'ID' &&
		clauseTokens.some(t => t.t === 'KW' && t.v === 'FROM')) {
		// alias before FROM — skip it for now, handled by FROM clause
	}

	// Collect table ref (everything before WHERE/JOIN keywords)
	const tableToks = [];
	while (i < clauseTokens.length) {
		const t = clauseTokens[i];
		if (t.t === 'KW' && ['WHERE','INNER','LEFT','RIGHT','FULL','CROSS','JOIN','OUTPUT'].includes(t.v)) break;
		tableToks.push(t); i++;
	}
	const tableStr = formatTableRef(tableToks);
	const lines = ['DELETE FROM ' + tableStr];
	return lines.join('\n');
}

function formatInsertClause(clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');

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

	const valuesIdx = clauseTokens.findIndex(t => t.t === 'KW' && t.v === 'VALUES');
	if (valuesIdx >= 0) {
		const intoToks = clauseTokens.slice(0, valuesIdx).filter(t => !(t.t === 'KW' && t.v === 'INTO'));
		const valuesToks = clauseTokens.slice(valuesIdx + 1);
		const lines = [];

		const colListStart = intoToks.findIndex(t => t.t === 'LP');
		let tableStr, colToks = null;
		if (colListStart >= 0) {
			const tableToks = intoToks.slice(0, colListStart);
			tableStr = tokStr(tableToks);
			const colListEnd = findMatchingParen(intoToks, colListStart);
			colToks = intoToks.slice(colListStart + 1, colListEnd);
		} else {
			tableStr = tokStr(intoToks);
		}

		if (!tableStr.includes('.') && !/^[@#]/.test(tableStr)) tableStr = 'dbo.' + tableStr;

		lines.push('INSERT INTO ' + tableStr);

		if (colToks) {
			const cols = splitAtCommas(colToks);
			lines.push('(');
			cols.forEach((ct, i) => {
				lines.push(INDENT + (i === 0 ? '' : ', ') + tokStr(ct));
			});
			lines.push(')');
		}

		lines.push('VALUES');

		const rowGroups = [];
		let i = 0;
		while (i < valuesToks.length) {
			if (valuesToks[i].t === 'LP') {
				const end = findMatchingParen(valuesToks, i);
				rowGroups.push(valuesToks.slice(i + 1, end));
				i = end + 1;
			} else {
				i++;
			}
		}

		rowGroups.forEach((rowToks, ri) => {
			lines.push(ri === 0 ? '(' : ', (');
			const vals = splitAtCommas(rowToks);
			vals.forEach((vt, vi) => {
				lines.push(INDENT + (vi === 0 ? '' : ', ') + tokStr(vt));
			});
			lines.push(')');
		});

		return lines;
	}

	return ['INSERT ' + tokStr(clauseTokens)];
}

function formatProcStatement(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL' && t.t !== 'GO');
	let i = 0;

	while (i < tokens.length && tokens[i].t === 'COMMENT') i++;

	let action = tokens[i++]?.v || 'ALTER';

	if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'OR') {
		i++;
		if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'ALTER') { action = 'CREATE OR ALTER'; i++; }
	}

	if (tokens[i]?.t === 'KW' && (tokens[i]?.v === 'PROCEDURE' || tokens[i]?.v === 'PROC')) i++;

	let procName = '';
	while (i < tokens.length && (tokens[i].t === 'ID' || tokens[i].t === 'BID' || tokens[i].t === 'DOT')) {
		procName += tokens[i].v; i++;
	}
	if (!procName.includes('.')) procName = 'dbo.' + procName;

	const lines = [`${action} PROCEDURE ${procName}`];

	const params = [];

	while (i < tokens.length) {
		const tok = tokens[i];

		if (tok.t === 'KW' && tok.v === 'WITH') {
			const j = i + 1;
			if (tokens[j]?.v === 'EXECUTE' || tokens[j]?.v === 'EXEC') {
				i += 2;
				if (tokens[i]?.v === 'AS') i++;
				if (tokens[i]?.t === 'ID') i++;
				continue;
			}
			break;
		}
		if (tok.t === 'KW' && tok.v === 'AS') break;
		if (tok.t === 'COMMENT') {
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

	// FIX #1: First param = 4 spaces, rest = tab + ', '
	params.forEach((p, pi) => {
		const parts = [p.name + ' ' + p.datatype];
		if (p.defaultVal !== null) parts.push('= ' + p.defaultVal);
		if (p.isOutput) parts.push('OUTPUT');
		const indent = pi === 0 ? '    ' : INDENT + ', ';  // FIX: 4 spaces for first param
		const comment = p.trailingComment ? '\t' + p.trailingComment : '';
		lines.push(indent + parts.join(' ') + comment);
	});

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

	while (i < tokens.length && tokens[i]?.v !== 'AS') i++;
	i++;
	if (i < tokens.length && tokens[i]?.v === 'BEGIN') i++;

	const bodyToks = [];
	let depth = 1, caseD = 0;
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok.t === 'GO') { i++; continue; }
		if (tok.t === 'KW' && tok.v === 'CASE') caseD++;
		if (tok.t === 'KW' && tok.v === 'BEGIN') depth++;
		if (tok.t === 'KW' && tok.v === 'END') {
			if (caseD > 0) { caseD--; }
			else { depth--; if (depth === 0) break; }
		}
		bodyToks.push(tok); i++;
	}

	formatProcBody(bodyToks, INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
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
		const raw = tokens[i++].v;
		datatype = raw.startsWith('[') ? raw.slice(1, -1).toUpperCase() : raw.toUpperCase();
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
			if (t.t === 'RP') break;
			if (t.t === 'KW' && ['OUTPUT','WITH','AS'].includes(t.v)) break;
			if (t.t === 'COMMENT') break;
			defToks.push(t); i++;
		}
		defaultVal = tokStr(defToks);
	}
 
	if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'OUTPUT') { isOutput = true; i++; }
 
	return { name, datatype, defaultVal, isOutput, trailingComment: null, nextIdx: i };
}

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

		if (tokens[i]?.t === 'LP') {
			const peekEnd = findMatchingParen(tokens, i);
			if (tokens[peekEnd + 1]?.t === 'KW' && tokens[peekEnd + 1]?.v === 'AS') {
				i = peekEnd + 1;
			}
		}

		if (tokens[i]?.t === 'KW' && tokens[i]?.v === 'AS') i++;
		if (tokens[i]?.t !== 'LP') break;
		const parenEnd = findMatchingParen(tokens, i);
		const bodyToks = tokens.slice(i + 1, parenEnd);
		i = parenEnd + 1;
		cteBlocks.push({ name: nameTok.v, description, bodyToks });
	}

	const mainToks = tokens.slice(i);

	// Register CTE names so formatTableRef doesn't add dbo. prefix
	_cteNames.clear();
	cteBlocks.forEach(cte => _cteNames.add(cte.name.toLowerCase().replace(/^\[|\]$/g, '')));

	cteBlocks.forEach((cte, ci) => {
		if (cte.description) lines.push(cte.description);
		lines.push(cte.name);
		lines.push('AS');
		lines.push('(');
		const inner = formatSelectStatement(cte.bodyToks, false);
		inner.split('\n').forEach(l => lines.push(INDENT + l));
		lines.push(ci < cteBlocks.length - 1 ? '),' : ')');
		lines.push('');
	});

	if (mainToks.length) lines.push(formatSelectStatement(mainToks, false));
	return lines.join('\n');
}

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

// ── Rob 2: clean passthrough for statements without dedicated formatters ──
function formatSimplePassthrough(keyword, clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	if (!clauseTokens.length) return keyword;
	return keyword + ' ' + tokStr(clauseTokens);
}

// ── FIX 10: EXEC param formatting ──
function formatExecClause(keyword, clauseTokens) {
	clauseTokens = clauseTokens.filter(t => t.t !== 'NL');
	if (!clauseTokens.length) return keyword;

	// Collect proc name (up to first @param or end)
	const nameToks = [];
	let i = 0;
	while (i < clauseTokens.length && clauseTokens[i].t !== 'VAR') {
		nameToks.push(clauseTokens[i++]);
	}
	const procName = tokStr(nameToks);

	const paramToks = clauseTokens.slice(i);
	if (!paramToks.length) return keyword + (procName ? ' ' + procName : '');

	const params = splitAtCommas(paramToks);
	if (params.length < 3) {
		// Inline for 1-2 params
		return keyword + ' ' + procName + ' ' + tokStr(paramToks);
	}

	// One param per line for 3+ params
	const lines = [keyword + ' ' + procName];
	params.forEach((p, pi) => {
		lines.push((pi === 0 ? INDENT + INDENT + '  ' : INDENT + INDENT + ', ') + tokStr(p));
	});
	return lines.join('\n');
}

function formatClause(clause) {
	switch (clause.type) {
		case 'SELECT':   return formatSelectClause(clause.tokens, false);
		case 'FROM':     return formatFromClause(clause.tokens);
		case 'WHERE':    return formatWhereClause(clause.tokens);
		case 'ORDER':    return formatOrderByClause(clause.tokens);
		case 'GROUP':    return formatGroupByClause(clause.tokens);
		case 'HAVING':   return formatHavingClause(clause.tokens);
		case 'DECLARE':  return formatDeclareClause(clause.tokens);
		case 'SET':      return formatSetDispatch(clause.tokens);
		case 'IF':       return formatIfClause(clause.tokens, INDENT);
		case 'WHILE':    return formatWhileClause(clause.tokens, INDENT);
		case 'DELETE':   return formatDeleteClause(clause.tokens);
		case 'INSERT':   return formatInsertClause(clause.tokens).join('\n');
		case 'RETURN':   return 'RETURN';
		case 'EXEC':
		case 'EXECUTE':  return formatExecClause(clause.type, clause.tokens);
		case 'PRINT':    return 'PRINT ' + tokStr(clause.tokens);
		case 'RAISERROR':return 'RAISERROR ' + tokStr(clause.tokens);
		case 'THROW':    return 'THROW ' + tokStr(clause.tokens);
		case 'MERGE':    return formatMergeClause(clause.tokens);
		case 'UPDATE':   return formatUpdateClause(clause.tokens);
		case 'INTO':     return formatIntoClause(clause.tokens);
		case 'CREATE':   return formatCreateClause(clause.tokens);
		// Rob 2: clean passthrough for valid statements without dedicated formatters
		case 'USE': case 'TRUNCATE': case 'DBCC':
		case 'GRANT': case 'REVOKE': case 'WAITFOR':
		case 'CHECKPOINT': case 'SAVE': case 'CLOSE':
		case 'DEALLOCATE': case 'OPEN': case 'KILL':
		case 'DISABLE': case 'ENABLE': case 'BACKUP': case 'RESTORE':
			return formatSimplePassthrough(clause.type, clause.tokens);
		default:
			// Strip the _ prefix from unknown-position tokens
			if (clause.type === '_') return tokStr(clause.tokens);
			return formatSimplePassthrough(clause.type, clause.tokens);
	}
}

function mergeDeleteClauses(clauses) {
	// Merge DELETE clause with its following FROM clause so DELETE FROM is treated as one unit
	const out = [];
	for (let i = 0; i < clauses.length; i++) {
		if (clauses[i].type === 'DELETE' && clauses[i + 1]?.type === 'FROM') {
			// Absorb FROM tokens into DELETE clause
			out.push({ type: 'DELETE', tokens: clauses[i + 1].tokens });
			i++; // skip the FROM clause
		} else {
			out.push(clauses[i]);
		}
	}
	return out;
}

function formatSelectStatement(tokens, noColumnNumbers) {
	tokens = tokens.filter(t => t.t !== 'NL' && t.t !== 'GO');
	let clauses = splitIntoClauses(tokens);
	clauses = mergeDeleteClauses(clauses);
	const hasSetOps = clauses.some(c => ['UNION','INTERSECT','EXCEPT'].includes(c.type));
	if (hasSetOps) return formatSetOperators(clauses);
	return clauses.map(c => {
		if (c.type === 'SELECT') return formatSelectClause(c.tokens, noColumnNumbers);
		return formatClause(c);
	}).join('\n\n');
}

function splitBatches(tokens) {
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

// Statements that must be treated as a single atomic unit — no clause splitting
const ATOMIC_STMT_KWS = new Set([
	'USE','GRANT','REVOKE','TRUNCATE','DBCC','WAITFOR',
	'CHECKPOINT','SAVE','CLOSE','DEALLOCATE','OPEN','KILL',
	'DISABLE','ENABLE','BACKUP','RESTORE',
]);

function formatBatch(tokens) {
	tokens = tokens.filter(t => t.t !== 'NL');
	if (!tokens.length) return null;

	if (tokens.every(t => t.t === 'COMMENT')) {
		return tokens.map(t => t.v).join('\n');
	}

	const firstKw = tokens.find(t => t.t === 'KW');
	if (!firstKw) {
		return tokStr(tokens);
	}

	// Rob 2: atomic statements — pass through without clause splitting
	if (ATOMIC_STMT_KWS.has(firstKw.v)) {
		return firstKw.v + (tokens.length > 1 ? ' ' + tokStr(tokens.filter(t => t !== firstKw)) : '');
	}

	if (firstKw.v === 'CREATE' || firstKw.v === 'ALTER') {
		const firstIdx = tokens.indexOf(firstKw);
		const nextKw = tokens.slice(firstIdx + 1).find(t => t.t === 'KW' && (t.v === 'PROCEDURE' || t.v === 'PROC'));
		if (nextKw) {
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

	if (firstKw.v === 'WITH') {
		const withIdx = tokens.indexOf(firstKw);
		return formatCTE(tokens.slice(withIdx + 1));
	}

	// TRY/CATCH at batch level
	const tryCatch = extractTryCatch(tokens);
	if (tryCatch) {
		const lines = [];
		if (tryCatch.before.length) lines.push(formatBatch(tryCatch.before));
		lines.push('BEGIN TRY');
		lines.push('');
		formatProcBody(tryCatch.tryBody, INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END TRY');
		lines.push('BEGIN CATCH');
		lines.push('');
		formatProcBody(tryCatch.catchBody, INDENT).forEach(l => lines.push(l === '' ? '' : INDENT + l));
		lines.push('');
		lines.push('END CATCH');
		if (tryCatch.after.length) { lines.push(''); lines.push(formatBatch(tryCatch.after)); }
		return lines.filter(l => l != null).join('\n');
	}

	return formatSelectStatement(tokens, false);
}

function formatSQL(sql, options = {}) {
	// Reset to defaults then apply per-call options (prevents mutation bleed between calls)
	MAX_INLINE_COL_LEN = 80;
	IN_LIST_BREAK_AT   = 4;
	REORDER_JOIN_ON    = false;
	if (typeof options.maxInlineColLen === 'number')  MAX_INLINE_COL_LEN = options.maxInlineColLen;
	if (typeof options.inListBreakAt   === 'number')  IN_LIST_BREAK_AT   = options.inListBreakAt;
	if (typeof options.reorderJoinOn   === 'boolean') REORDER_JOIN_ON    = options.reorderJoinOn;

	try {
		const tokens = tokenize(sql);
		if (!tokens.length) return sql;

		let workTokens = tokens;
		if (workTokens[0]?.t === 'SEMI') workTokens = workTokens.slice(1);

		const firstMeaningful = workTokens.find(t => t.t !== 'NL');
		if (firstMeaningful?.t === 'KW' && firstMeaningful.v === 'WITH') {
			const withIdx = workTokens.indexOf(firstMeaningful);
			return formatCTE(workTokens.slice(withIdx + 1));
		}

		const batches = splitBatches(workTokens);

		if (batches.length <= 1) {
			const result = formatBatch(workTokens);
			return result || sql;
		}

		const formatted = [];
		for (const batch of batches) {
			const result = formatBatch(batch);
			if (result) formatted.push(result);
		}
		return formatted.join('\nGO\n');

	} catch (err) {
		// Missing 5: re-throw so extension.js can show the actual error message
		console.error('[SQL Zero Doctrine] formatter error:', err);
		throw err;
	}
}

module.exports = { formatSQL };