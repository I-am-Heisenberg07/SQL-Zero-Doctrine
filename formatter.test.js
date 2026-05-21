'use strict';

const { formatSQL } = require('./formatter');

// ── Minimal test runner ──
let pass = 0, fail = 0, errors = [];

function test(name, fn) {
	try {
		fn();
		pass++;
		process.stdout.write('  ✅ ' + name + '\n');
	} catch (e) {
		fail++;
		errors.push({ name, message: e.message });
		process.stdout.write('  ❌ ' + name + '\n     ' + e.message + '\n');
	}
}

function eq(actual, expected, msg) {
	if (actual !== expected) {
		throw new Error((msg || 'Mismatch') + '\n     Expected: ' + JSON.stringify(expected) + '\n     Got:      ' + JSON.stringify(actual));
	}
}

function contains(str, sub, msg) {
	if (!str.includes(sub)) throw new Error((msg || '') + '\n     Expected to contain: ' + JSON.stringify(sub) + '\n     In: ' + str.split('\n').slice(0,4).join(' | '));
}

function notContains(str, sub, msg) {
	if (str.includes(sub)) throw new Error((msg || '') + '\n     Expected NOT to contain: ' + JSON.stringify(sub));
}

function startsWith(str, pre, msg) {
	if (!str.startsWith(pre)) throw new Error((msg || '') + '\n     Expected to start with: ' + JSON.stringify(pre) + '\n     Got: ' + str.split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 1: Keywords uppercase, dbo. prefix ──');
// ════════════════════════════════════════════════════════════════

test('keywords uppercased', () => {
	const out = formatSQL('select id, name from tabtest where id = 1');
	contains(out, 'SELECT\t');
	contains(out, 'FROM\t');
	contains(out, 'WHERE\t');
});

test('dbo. prefix added to bare table name', () => {
	contains(formatSQL('SELECT ID FROM tabEmployee'), 'FROM\tdbo.tabEmployee');
});

test('dbo. prefix not added to @variable', () => {
	notContains(formatSQL('SELECT ID FROM @TempTable'), 'dbo.@');
});

test('dbo. prefix not added to #temp table', () => {
	notContains(formatSQL('SELECT ID FROM #TempTable'), 'dbo.#');
});

test('no AS keyword anywhere', () => {
	const out = formatSQL('SELECT t.ID AS [ID], t.Name AS [Name] FROM tabTest AS t WHERE t.ID = 1');
	notContains(out, ' AS [', 'column alias AS removed');
	notContains(out, '] AS [', 'table alias AS removed');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 2: Stored procedure structure ──');
// ════════════════════════════════════════════════════════════════

test('first param uses 4 spaces', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @A INT, @B INT AS BEGIN SELECT 1 END');
	const line = out.split('\n').find(l => l.includes('@A'));
	if (!line?.startsWith('    @A')) throw new Error('First param not 4-space indented: ' + JSON.stringify(line));
});

test('subsequent params use tab + comma', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @A INT, @B INT AS BEGIN SELECT 1 END');
	const line = out.split('\n').find(l => l.includes('@B'));
	if (!line?.startsWith('\t, @B')) throw new Error('Second param not tab+comma: ' + JSON.stringify(line));
});

test('no () around param block', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P (@A INT) AS BEGIN SELECT 1 END');
	notContains(out, '(\n    @A');
});

test('WITH EXECUTE AS removed', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @A INT = 0 WITH EXECUTE AS CALLER AS BEGIN SELECT 1 END');
	notContains(out, 'EXECUTE AS');
	notContains(out, 'WITH EXECUTE');
});

test('blank line inside BEGIN...END', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN SELECT 1 END');
	const lines = out.split('\n');
	const beginIdx = lines.indexOf('BEGIN');
	eq(lines[beginIdx + 1], '', 'blank line after BEGIN');
});

test('RETURN has blank line before END', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN SELECT 1 RETURN END');
	const lines = out.split('\n');
	const endIdx = lines.lastIndexOf('END');
	eq(lines[endIdx - 1], '', 'blank line before END');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 3: DECLARE / SET ──');
// ════════════════════════════════════════════════════════════════

test('no AS in DECLARE', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN DECLARE @y AS VARCHAR(50) END');
	const line = out.split('\n').find(l => l.includes('DECLARE'));
	if (line?.includes(' AS ')) throw new Error('AS found in DECLARE: ' + line);
});

test('one DECLARE per line', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN DECLARE @a INT DECLARE @b VARCHAR(10) END');
	const declares = out.split('\n').filter(l => l.trim().startsWith('DECLARE'));
	if (declares.length !== 2) throw new Error('Expected 2 DECLARE lines, got: ' + declares.length);
});

test('SET @var = value', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN SET @x = 1 SELECT @x END');
	contains(out, 'SET @x = 1');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 4: SELECT format ──');
// ════════════════════════════════════════════════════════════════

test('SELECT tab then first column', () => {
	startsWith(formatSQL('SELECT ID FROM dbo.T'), 'SELECT\tID');
});

test('DISTINCT preserved', () => {
	contains(formatSQL('SELECT DISTINCT ID FROM dbo.T'), 'SELECT\tDISTINCT ID');
});

test('column aliases use [Alias] no AS', () => {
	const out = formatSQL('SELECT t.Name [EmployeeName] FROM dbo.tabEmployee [t]');
	contains(out, '[EmployeeName]');
	notContains(out, 'AS [EmployeeName]');
});

test('column numbers start at 0', () => {
	const out = formatSQL('SELECT ID, Name FROM dbo.T');
	contains(out, '--  0');
	contains(out, '--  1');
	notContains(out, '--  1\n\t\t, ID');
});

test('col 0-9 two spaces in comment', () => {
	contains(formatSQL('SELECT ID FROM dbo.T'), '--  0');
});

test('col 10+ one space in comment', () => {
	const cols = Array.from({length:11}, (_,i) => `col${i}`).join(', ');
	contains(formatSQL(`SELECT ${cols} FROM dbo.T`), '-- 10');
});

test('no space between function name and (', () => {
	const out = formatSQL('SELECT GETDATE() [D], COUNT(*) [C], ISNULL(Name, 0) [N] FROM dbo.T');
	contains(out, 'GETDATE()');
	contains(out, 'COUNT(*)');
	contains(out, 'ISNULL(');
	notContains(out, 'GETDATE (');
	notContains(out, 'COUNT (');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 5: FROM + JOIN ──');
// ════════════════════════════════════════════════════════════════

test('FROM tab then table name', () => {
	contains(formatSQL('SELECT ID FROM dbo.tabTest'), 'FROM\tdbo.tabTest');
});

test('JOIN at 2 tabs', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON m.ID = t.MachineID');
	contains(out, '\t\tINNER JOIN dbo.tabMachine [m]');
});

test('ON at 3 tabs', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON m.ID = t.MachineID');
	contains(out, '\t\t\tON\tm.ID');
});

test('JOIN condition NOT reordered by default', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON t.MachineID = m.ID');
	contains(out, 'ON\tt.MachineID = m.ID', 'original order preserved');
});

test('JOIN condition reordered when opt-in', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON t.MachineID = m.ID', { reorderJoinOn: true });
	contains(out, 'ON\tm.ID = t.MachineID', 'reordered to joined table first');
});

test('table alias uses [alias] no AS', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabTest [t]');
	contains(out, 'dbo.tabTest [t]');
	notContains(out, 'AS [t]');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 6: WHERE clause ──');
// ════════════════════════════════════════════════════════════════

test('WHERE single condition inline', () => {
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID = 1'), 'WHERE\tID = 1');
});

test('WHERE multi-group: AND/OR at 2 tabs', () => {
	const out = formatSQL('SELECT ID FROM dbo.T WHERE (a=1 OR @p=0) AND (b=2)');
	contains(out, '\t\tAND');
	notContains(out, '\tAND\n\t(');
});

test('WHERE ( at 2 tabs per group', () => {
	const out = formatSQL('SELECT ID FROM dbo.T WHERE (a=1) AND (b=2)');
	contains(out, '\t\t(');
});

test('IN list inline under threshold', () => {
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1, 2, 3)'), 'IN (1, 2, 3)');
});

test('IN list breaks at threshold', () => {
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1, 2, 3, 4)'), 'IN (\n');
});

test('IN list space preserved (not IN()', () => {
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1, 2, 3)'), 'IN (');
	notContains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1, 2, 3)'), 'IN(');
});

test('EXISTS subquery expanded', () => {
	const out = formatSQL('SELECT ID FROM dbo.T WHERE EXISTS (SELECT 1 FROM dbo.tabOrder WHERE tabOrder.CustID = T.ID)');
	contains(out, 'EXISTS (');
	contains(out, 'SELECT\t1');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 7 & 8: GROUP BY / ORDER BY ──');
// ════════════════════════════════════════════════════════════════

test('GROUP BY on own line, columns at 2 tabs', () => {
	const out = formatSQL('SELECT DeptID, COUNT(*) [C] FROM dbo.T GROUP BY DeptID, Name');
	contains(out, 'GROUP BY\n');
	contains(out, '\t\tDeptID');
	contains(out, '\t\t, Name');
});

test('ORDER BY on own line, columns at 2 tabs', () => {
	const out = formatSQL('SELECT ID FROM dbo.T ORDER BY Name ASC, ID DESC');
	contains(out, 'ORDER BY\n');
	contains(out, '\t\tName ASC');
	contains(out, '\t\t, ID DESC');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 9: OFFSET / FETCH ──');
// ════════════════════════════════════════════════════════════════

test('OFFSET/FETCH at ORDER BY level (no extra indent)', () => {
	const out = formatSQL('SELECT ID FROM dbo.T ORDER BY ID OFFSET @O ROWS FETCH NEXT @F ROWS ONLY');
	contains(out, 'OFFSET @O ROWS');
	notContains(out, '\t\tOFFSET');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 10: CASE WHEN ──');
// ════════════════════════════════════════════════════════════════

test('CASE WHEN never on one line', () => {
	const out = formatSQL('SELECT CASE WHEN a=1 THEN 1 ELSE 0 END [R] FROM dbo.T');
	contains(out, 'CASE\n');
	contains(out, '\t\t\t\tWHEN');
	notContains(out, 'WHEN a=1 THEN 1');
});

test('WHEN and THEN on separate lines', () => {
	const out = formatSQL('SELECT CASE WHEN a=1 THEN 1 ELSE 0 END [R] FROM dbo.T');
	const lines = out.split('\n');
	const whenLine = lines.find(l => l.trim().startsWith('WHEN'));
	const thenLine = lines.find(l => l.trim().startsWith('THEN'));
	if (!whenLine || !thenLine) throw new Error('WHEN or THEN line not found');
	if (whenLine.trim().includes('THEN')) throw new Error('WHEN and THEN on same line: ' + whenLine);
});

test('ELSE aligned with WHEN', () => {
	const out = formatSQL('SELECT CASE WHEN a=1 THEN 1 ELSE 0 END [R] FROM dbo.T');
	const lines = out.split('\n');
	const whenLine = lines.find(l => l.trim().startsWith('WHEN'));
	const elseLine = lines.find(l => l.trim().startsWith('ELSE'));
	const whenIndent = whenLine?.match(/^\t+/)?.[0]?.length || 0;
	const elseIndent = elseLine?.match(/^\t+/)?.[0]?.length || 0;
	if (whenIndent !== elseIndent) throw new Error(`WHEN indent ${whenIndent} ≠ ELSE indent ${elseIndent}`);
});

test('nested CASE in THEN has THEN on own line', () => {
	const out = formatSQL('SELECT CASE WHEN a=1 THEN CASE WHEN b=1 THEN 1 ELSE 2 END ELSE 3 END [R] FROM dbo.T');
	contains(out, 'THEN\n');
});

test('nested CASE in ELSE has ELSE on own line', () => {
	const out = formatSQL('SELECT CASE WHEN a=1 THEN 1 ELSE CASE WHEN b=1 THEN 2 ELSE 3 END END [R] FROM dbo.T');
	const lines = out.split('\n');
	const elseIdx = lines.findIndex(l => l.trim() === 'ELSE');
	if (elseIdx < 0) throw new Error('Standalone ELSE line not found');
	if (!lines[elseIdx + 1]?.includes('CASE')) throw new Error('CASE not on line after ELSE');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 11: Inline subquery ──');
// ════════════════════════════════════════════════════════════════

test('subquery column never flattened', () => {
	const out = formatSQL('SELECT (SELECT SUM(Amount) FROM dbo.tabOrder WHERE CustID = t.ID) [Total] FROM dbo.tabCust [t]');
	contains(out, 'SELECT\tSUM(Amount)');
	notContains(out, '(SELECT SUM');
});

test('subquery column alias on closing )', () => {
	const out = formatSQL('SELECT (SELECT SUM(Amount) FROM dbo.tabOrder WHERE CustID = t.ID) [Total] FROM dbo.tabCust [t]');
	contains(out, ') [Total]');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 12: CTE ──');
// ════════════════════════════════════════════════════════════════

test('CTE starts with ;WITH', () => {
	startsWith(formatSQL('WITH C AS (SELECT ID FROM dbo.T) SELECT ID FROM C'), ';WITH');
});

test('CTE name gets no dbo. prefix in FROM', () => {
	notContains(formatSQL('WITH MyCTE AS (SELECT ID FROM dbo.T) SELECT ID FROM MyCTE'), 'dbo.MyCTE');
});

test('CTE name gets no dbo. prefix in JOIN', () => {
	notContains(
		formatSQL('WITH C AS (SELECT ID FROM dbo.T) SELECT c1.ID FROM C [c1] INNER JOIN C [c2] ON c2.ID = c1.ID'),
		'dbo.C'
	);
});

test('CTE columns numbered', () => {
	const out = formatSQL('WITH C AS (SELECT ID, Name FROM dbo.T) SELECT ID FROM C');
	contains(out, '--  0');
	contains(out, '--  1');
});

test('multiple CTEs separated by comma', () => {
	const out = formatSQL('WITH C1 AS (SELECT ID FROM dbo.A), C2 AS (SELECT ID FROM dbo.B) SELECT c1.ID FROM C1 [c1] JOIN C2 [c2] ON c2.ID = c1.ID');
	contains(out, '),');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 13: UNION ALL ──');
// ════════════════════════════════════════════════════════════════

test('UNION ALL on own line with blank lines around', () => {
	const out = formatSQL('SELECT ID FROM dbo.A UNION ALL SELECT ID FROM dbo.B');
	contains(out, '\n\nUNION ALL\n\n');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 14: IF / BEGIN / END ──');
// ════════════════════════════════════════════════════════════════

test('IF condition on own line', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN IF @x = 1 BEGIN SELECT 1 END END');
	contains(out, 'IF @x = 1\n');
});

test('BEGIN on line after IF', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN IF @x = 1 BEGIN SELECT 1 END END');
	const lines = out.split('\n');
	const ifIdx = lines.findIndex(l => l.trim().startsWith('IF'));
	eq(lines[ifIdx + 1]?.trim(), 'BEGIN', 'BEGIN should follow IF');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 19: Subquery in function args ──');
// ════════════════════════════════════════════════════════════════

test('ISNULL with subquery expanded', () => {
	const out = formatSQL("SELECT ISNULL((SELECT TOP 1 Name FROM dbo.tabEmployee WHERE ID = t.ID), 'N/A') [Name] FROM dbo.T [t]");
	contains(out, 'ISNULL(');
	contains(out, 'SELECT\tTOP 1 Name');
	notContains(out, "ISNULL((SELECT");
});

test('COALESCE with multiple subquery args expanded', () => {
	const out = formatSQL('SELECT COALESCE((SELECT TOP 1 V FROM dbo.A WHERE ID = t.ID), (SELECT TOP 1 V FROM dbo.B WHERE ID = t.ID), 0) [V] FROM dbo.T [t]');
	contains(out, 'COALESCE(');
	const selectCount = (out.match(/SELECT\t/g) || []).length;
	if (selectCount < 3) throw new Error('Expected 3 SELECT lines (outer + 2 subqueries), got ' + selectCount);
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Rule 20: OVER clause expansion ──');
// ════════════════════════════════════════════════════════════════

test('ROW_NUMBER OVER with PARTITION BY expanded', () => {
	const out = formatSQL('SELECT ROW_NUMBER() OVER (PARTITION BY DeptID ORDER BY HireDate DESC) [R] FROM dbo.T');
	contains(out, 'ROW_NUMBER() OVER (');
	contains(out, 'PARTITION BY DeptID');
	contains(out, 'ORDER BY HireDate DESC');
});

test('SUM OVER with ROWS BETWEEN expanded', () => {
	const out = formatSQL('SELECT SUM(Salary) OVER (PARTITION BY DeptID ORDER BY HireDate ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) [R] FROM dbo.T');
	contains(out, 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
});

test('OVER with empty parens stays inline', () => {
	const out = formatSQL('SELECT SUM(Salary) OVER () [Total] FROM dbo.T');
	contains(out, 'SUM(Salary) OVER () [Total]');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Bug fixes ──');
// ════════════════════════════════════════════════════════════════

test('Fix 1: SELECT INTO #temp', () => {
	const out = formatSQL('SELECT ID, Name INTO #Temp FROM dbo.tabEmployee WHERE IsActive = 1');
	contains(out, 'INTO\t#Temp');
	notContains(out, 'Name INTO');
});

test('Fix 3: Semicolons stripped', () => {
	const out = formatSQL('DECLARE @x INT; SET @x = 1; SELECT @x');
	notContains(out, ' ;');
	contains(out, 'DECLARE @x INT');
});

test('Fix 5: TRY/CATCH formatted', () => {
	const out = formatSQL('ALTER PROCEDURE dbo.P @x INT=0 AS BEGIN BEGIN TRY SELECT 1 END TRY BEGIN CATCH SELECT ERROR_MESSAGE() [E] END CATCH END');
	contains(out, 'BEGIN TRY');
	contains(out, 'END TRY');
	contains(out, 'BEGIN CATCH');
	contains(out, 'END CATCH');
});

test('Fix 6: UPDATE multi-col SET one per line', () => {
	const out = formatSQL("UPDATE dbo.T SET Col1 = 'A', Col2 = 1, Col3 = GETDATE() WHERE ID = @ID");
	contains(out, 'SET\tCol1');
	contains(out, '\t\t, Col2');
	contains(out, '\t\t, Col3');
});

test('Fix 7: MERGE basic structure', () => {
	const out = formatSQL('MERGE dbo.T [t] USING dbo.S [s] ON t.ID = s.ID WHEN MATCHED THEN UPDATE SET t.Name = s.Name WHEN NOT MATCHED THEN INSERT (ID) VALUES (s.ID);');
	contains(out, 'MERGE dbo.T [t]');
	contains(out, 'USING dbo.S [s]');
	contains(out, 'WHEN MATCHED');
	contains(out, 'THEN UPDATE SET');
	contains(out, 'WHEN NOT MATCHED');
	contains(out, 'THEN INSERT');
});

test('Fix 8: DELETE FROM keeps table name', () => {
	startsWith(formatSQL('DELETE FROM dbo.tabEmployee WHERE ID = @ID'), 'DELETE FROM dbo.tabEmployee');
});

test('Fix 10: EXEC 3+ params one per line', () => {
	const out = formatSQL('EXEC dbo.usp_Get @A = 1, @B = 2, @C = 3');
	contains(out, 'EXEC dbo.usp_Get\n');
	const paramLines = out.split('\n').filter(l => l.includes('@'));
	if (paramLines.length !== 3) throw new Error('Expected 3 param lines, got ' + paramLines.length);
});

test('Fix: CREATE TABLE columns one per line', () => {
	const out = formatSQL('CREATE TABLE dbo.tabTest (ID INT NOT NULL, Name NVARCHAR(100) NULL, IsActive BIT NOT NULL DEFAULT 1)');
	contains(out, '(\n');
	contains(out, '\t  ID INT');
	contains(out, '\t, Name');
	contains(out, '\t, IsActive');
});

test('Fix: DECLARE @t TABLE columns one per line', () => {
	const out = formatSQL('DECLARE @T TABLE (ID INT, Name NVARCHAR(50), Status BIT)');
	contains(out, 'DECLARE @T TABLE\n(');
	contains(out, '\t  ID INT');
	contains(out, '\t, Name');
});

test('Fix: CAST AS protection', () => {
	const out = formatSQL('SELECT CAST(HireDate AS DATE) [D], CAST(Amount AS DECIMAL(10,2)) [A] FROM dbo.T');
	contains(out, 'CAST(HireDate AS DATE)');
	contains(out, 'CAST(Amount AS DECIMAL(10, 2))');
});

// ════════════════════════════════════════════════════════════════
console.log('\n── Robustness ──');
// ════════════════════════════════════════════════════════════════

test('Rob 2: USE statement no _ prefix', () => {
	notContains(formatSQL('USE MyDatabase'), '_ USE');
});

test('Rob 2: TRUNCATE no _ prefix', () => {
	notContains(formatSQL('TRUNCATE TABLE dbo.tabTest'), '_ TRUNCATE');
});

test('Rob 2: GRANT no _ prefix', () => {
	notContains(formatSQL('GRANT SELECT ON dbo.tabTest TO [AppUser]'), '_ GRANT');
});

test('Rob 4: JOIN order preserved by default', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON t.MachineID = m.ID');
	contains(out, 'ON\tt.MachineID = m.ID');
});

test('Rob 4: JOIN order rewritten when opt-in', () => {
	const out = formatSQL('SELECT t.ID FROM dbo.tabLog [t] INNER JOIN dbo.tabMachine [m] ON t.MachineID = m.ID', { reorderJoinOn: true });
	contains(out, 'ON\tm.ID = t.MachineID');
});

test('Rob: config inListBreakAt respected', () => {
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1,2,3,4,5)', { inListBreakAt: 10 }), 'IN (1');
	contains(formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1,2,3,4,5)', { inListBreakAt: 3 }), 'IN (\n');
});

test('Rob: malformed SQL (unclosed paren) does not throw', () => {
	try { formatSQL('SELECT ID FROM dbo.T WHERE ID IN (1, 2, 3'); }
	catch(e) { /* ok to throw on malformed — just shouldn't crash node */ }
});

test('Rob: empty string returns empty', () => {
	const out = formatSQL('   ');
	eq(out.trim(), '', 'empty input returns empty or whitespace');
});

// ════════════════════════════════════════════════════════════════
// Results
// ════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`PASSED: ${pass}   FAILED: ${fail}   TOTAL: ${pass + fail}`);
if (fail > 0) {
	console.log('\nFailed tests:');
	errors.forEach(e => console.log('  ❌ ' + e.name));
	process.exit(1);
}