const vscode = require('vscode');
const { formatSQL } = require('./formatter');

// --- Module-level state ---
let statusBar;
const previewContentMap = new Map();
const PREVIEW_SCHEME = 'sql-zero-doctrine-preview';
const SQL_LANG_IDS = ['sql', 'SQL', 'tsql', 'mssql', 'sql-ms'];

// --- Helpers ---
function isSqlDoc(document) {
	return SQL_LANG_IDS.includes(document.languageId) ||
		document.fileName.toLowerCase().endsWith('.sql');
}

function setStatus(icon, label, tooltip) {
	if (!statusBar) return;
	statusBar.text = `${icon} ${label}`;
	statusBar.tooltip = tooltip;
}

function setStatusIdle() {
	setStatus('$(database)', 'ZD', 'SQL Zero Doctrine — Click to format');
}

function setStatusFormatting() {
	setStatus('$(sync~spin)', 'ZD', 'Zero Doctrine: formatting...');
}

function setStatusSuccess() {
	const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	setStatus('$(check)', `ZD ${time}`, `Zero Doctrine: last formatted at ${time}`);
}

function setStatusError() {
	setStatus('$(error)', 'ZD', 'Zero Doctrine: formatting failed — click to retry');
}

// --- Read user config ---
function getOptions() {
	const config = vscode.workspace.getConfiguration('sqlZeroDoctrine');
	return {
		inListBreakAt:   config.get('inListBreakAt', 4),
		maxInlineColLen: config.get('maxInlineColLen', 80),
		reorderJoinOn:   config.get('reorderJoinOn', false),
	};
}

// --- Providers (Shift+Alt+F path — direct apply, no diff preview) ---
function runFormatter(document) {
	const fullText = document.getText();
	if (!fullText.trim()) { vscode.window.showWarningMessage('File is empty.'); return []; }

	setStatusFormatting();
	let formatted = '';
	try {
		formatted = formatSQL(fullText, getOptions());
	} catch (err) {
		vscode.window.showErrorMessage(`❌ Formatting failed: ${err.message}`);
		setStatusError();
		return [];
	}

	if (!formatted) return [];

	setStatusSuccess();
	vscode.window.showInformationMessage('✅ SQL formatted. Zero Doctrine applied.');
	const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(fullText.length));
	return [vscode.TextEdit.replace(fullRange, formatted.trim())];
}

function runFormatterForSelection(document, range) {
	const selectedText = document.getText(range);
	if (!selectedText.trim()) { vscode.window.showWarningMessage('No text selected.'); return []; }

	setStatusFormatting();
	let formatted = '';
	try {
		formatted = formatSQL(selectedText, getOptions());
	} catch (err) {
		vscode.window.showErrorMessage(`❌ Formatting failed: ${err.message}`);
		setStatusError();
		return [];
	}

	if (!formatted) return [];

	setStatusSuccess();
	vscode.window.showInformationMessage('✅ Selection formatted. Zero Doctrine applied.');
	return [vscode.TextEdit.replace(range, formatted.trim())];
}

// --- Command handler (right-click / keybinding path — shows diff preview) ---
async function formatWithPreview(editor, sql, range) {
	setStatusFormatting();
	let formatted = '';
	try {
		formatted = formatSQL(sql, getOptions());
	} catch (err) {
		vscode.window.showErrorMessage(`❌ Formatting failed: ${err.message}`);
		setStatusError();
		return;
	}

	if (!formatted) return;

	const previewUri = vscode.Uri.parse(`${PREVIEW_SCHEME}://preview/${Date.now()}.sql`);
	previewContentMap.set(previewUri.toString(), formatted.trim());

	await vscode.commands.executeCommand(
		'vscode.diff',
		editor.document.uri,
		previewUri,
		'Zero Doctrine: Original ↔ Formatted'
	);

	const choice = await vscode.window.showInformationMessage(
		'Apply Zero Doctrine formatting?',
		'Apply',
		'Discard'
	);

	previewContentMap.delete(previewUri.toString());

	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	await vscode.window.showTextDocument(editor.document);

	if (choice === 'Apply') {
		const wsEdit = new vscode.WorkspaceEdit();
		wsEdit.set(editor.document.uri, [vscode.TextEdit.replace(range, formatted.trim())]);
		await vscode.workspace.applyEdit(wsEdit);
		setStatusSuccess();
		vscode.window.showInformationMessage('✅ Zero Doctrine applied.');
	} else {
		setStatusIdle();
	}
}

function activate(context) {
	// Status bar item
	statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'sqlZeroDoctrine.formatFile';
	setStatusIdle();

	const updateStatusVis = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && isSqlDoc(editor.document)) statusBar.show();
		else statusBar.hide();
	};
	updateStatusVis();

	// Diff preview content provider
	const previewProvider = vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
		provideTextDocumentContent(uri) {
			return previewContentMap.get(uri.toString()) || '';
		}
	});

	// Document formatting providers (used by Shift+Alt+F — direct apply, no diff)
	const formatProviders = SQL_LANG_IDS.map(langId =>
		vscode.languages.registerDocumentFormattingEditProvider(langId, {
			provideDocumentFormattingEdits(document) { return runFormatter(document); }
		})
	);
	const rangeFormatProviders = SQL_LANG_IDS.map(langId =>
		vscode.languages.registerDocumentRangeFormattingEditProvider(langId, {
			provideDocumentRangeFormattingEdits(document, range) { return runFormatterForSelection(document, range); }
		})
	);

	// Format Document command (right-click + Ctrl+Shift+Alt+F — with diff preview)
	const formatCmd = vscode.commands.registerCommand('sqlZeroDoctrine.formatFile', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
		const fullText = editor.document.getText();
		if (!fullText.trim()) { vscode.window.showWarningMessage('File is empty.'); return; }
		const fullRange = new vscode.Range(
			editor.document.positionAt(0),
			editor.document.positionAt(fullText.length)
		);
		await formatWithPreview(editor, fullText, fullRange);
	});

	// Format Selection command (right-click + Ctrl+Shift+Alt+G — with diff preview)
	const selectionCmd = vscode.commands.registerCommand('sqlZeroDoctrine.formatSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
		if (editor.selection.isEmpty) { vscode.window.showWarningMessage('No text selected.'); return; }
		await formatWithPreview(editor, editor.document.getText(editor.selection), editor.selection);
	});

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(updateStatusVis),
		statusBar,
		previewProvider,
		...formatProviders,
		...rangeFormatProviders,
		formatCmd,
		selectionCmd
	);
}

function deactivate() {}

module.exports = { activate, deactivate };