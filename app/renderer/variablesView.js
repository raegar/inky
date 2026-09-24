// Variables panel: shows the story's global variables (VAR, CONST and LIST) with their
// values in the current playthrough, and lets you change them to try a different route
// through the story without playing it again to set things up.

const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const InkProject = require('./inkProject.js').InkProject;
const LiveCompiler = require('./liveCompiler.js').LiveCompiler;
const NavView = require('./navView.js').NavView;

// Values are read in one expression, "{a}@@{b}@@...", split on this
const SEPARATOR = '@@';

let values = null;      // name -> value as printed by ink, or null if not known yet

function ensurePanel() {
    let $panel = $('#variables-wrapper');
    if ($panel.length) return $panel;

    $panel = $(`<div class="nav-wrapper hidden" id="variables-wrapper">
        <nav class="nav-group">
            <h5 class="nav-group-title">Variables</h5>
        </nav>
        <p class="variablesIntro">Values in this playthrough. Change one to try a different route: it stays changed, even after you edit, until you restart the story.</p>
        <div class="variablesBody"></div>
    </div>`);
    $('.sidebar').append($panel);
    return $panel;
}

function isVisible() {
    return $('#variables-wrapper').length > 0 && !$('#variables-wrapper').hasClass('hidden');
}

// Every global variable declared in the project:
// { name, kind: 'VAR'|'CONST'|'LIST', initial, type: 'number'|'bool'|'string'|'list'|'divert'|'other' }
function scanDeclarations() {
    const declarations = [];
    const project = InkProject.currentProject;
    if (!project) return declarations;

    for (const inkFile of project.files || []) {
        const session = inkFile.getAceSession();
        for (let row = 0; row < session.getLength(); row++) {
            const tokens = session.getTokens(row);
            const keyword = tokens.find(t => t.type === 'var-decl.keyword' || t.type === 'list-decl.keyword');
            if (!keyword) continue;
            const nameToken = tokens.find(t => t.type === 'var-decl.name' || t.type === 'list-decl.name');
            if (!nameToken) continue;

            const line = session.getLine(row);
            const initial = line.slice(line.indexOf('=') + 1).replace(/\/\/.*$/, '').trim();
            const kind = keyword.value.trim().toUpperCase();
            let type = 'other';
            if (kind === 'LIST') type = 'list';
            else if (/^-?\d+(\.\d+)?$/.test(initial)) type = 'number';
            else if (/^(true|false)$/.test(initial)) type = 'bool';
            else if (/^"/.test(initial)) type = 'string';
            else if (/^->/.test(initial)) type = 'divert';
            declarations.push({ name: nameToken.value, kind, initial, type });
        }
    }
    return declarations;
}

// Reads every variable's current value from the running story, then calls back. Only
// call it while the story is waiting for a choice.
function refresh(callback) {
    const done = () => { render(); if (callback) callback(); };
    const declarations = scanDeclarations();
    if (declarations.length === 0) { values = {}; done(); return; }

    let answered = false;
    const finish = (result, error) => {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        if (error || typeof result !== 'string') {
            values = null;
        } else {
            const parts = result.split(SEPARATOR);
            values = {};
            declarations.forEach((d, i) => { values[d.name] = parts[i] !== undefined ? parts[i] : ''; });
        }
        done();
    };
    // No answer means the story isn't running (e.g. it has errors)
    const timer = setTimeout(() => finish(null, 'timeout'), 1500);
    LiveCompiler.evaluateExpression(declarations.map(d => `{${d.name}}`).join(SEPARATOR), finish);
}

// Turns what was typed into an ink value for the variable's type. Returns { value } or { error }.
function inkValueFor(declaration, text) {
    text = text.trim();
    switch (declaration.type) {
        case 'number':
            return /^-?\d+(\.\d+)?$/.test(text) ? { value: text } : { error: 'Enter a number' };
        case 'bool':
            return /^(true|false)$/.test(text) ? { value: text } : { error: 'Enter true or false' };
        case 'string':
            // ink strings can't contain double quotes, and only plain characters reach inklecate intact
            if (/[^\x20-\x7e]/.test(text)) return { error: 'Only plain letters, numbers and punctuation can be set here' };
            return { value: `"${text.replace(/"/g, "'")}"` };
        case 'list': {
            const items = text.split(',').map(s => s.trim()).filter(s => s);
            if (items.some(item => !/^[A-Za-z_][\w.]*$/.test(item))) return { error: 'Enter list items separated by commas, e.g. happy, calm' };
            return { value: `(${items.join(', ')})` };
        }
        case 'divert': {
            const target = text.replace(/^->\s*/, '');
            if (!/^[A-Za-z_][\w.]*$/.test(target)) return { error: 'Enter the name of a knot or stitch' };
            return { value: `-> ${target}` };
        }
        default:
            return text ? { value: text } : { error: 'Enter a value' };
    }
}

function setVariable(declaration, text, $input) {
    const result = inkValueFor(declaration, text);
    if (result.error) {
        if ($input) $input.addClass('invalid').attr('title', result.error);
        return;
    }
    LiveCompiler.setVariable(declaration.name, result.value);
}

function render() {
    const $panel = ensurePanel();
    if ($panel.hasClass('hidden')) return;
    const $body = $panel.find('.variablesBody');
    $body.empty();

    const declarations = scanDeclarations();
    if (declarations.length === 0) {
        $body.append($(`<p class="variablesEmpty">This story has no variables yet. Declare one with a line like <code>VAR gold = 0</code>.</p>`));
        return;
    }
    if (values === null) {
        $body.append($(`<p class="variablesEmpty">Values will appear here while the story is playing.</p>`));
    }

    const overrides = LiveCompiler.getVariableOverrides();
    const $table = $(`<table class="variablesTable"><tbody></tbody></table>`);
    for (const d of declarations) {
        const $row = $(`<tr><td class="variableName"></td><td class="variableValue"></td></tr>`);
        $row.find('.variableName').text(d.name).attr('title', `${d.kind} ${d.name} = ${d.initial}`);
        const current = values && d.name in values ? values[d.name] : null;
        const $cell = $row.find('.variableValue');

        if (d.kind === 'CONST') {
            $cell.append($(`<span class="variableConst"></span>`).text(current !== null ? current : d.initial).attr('title', 'A constant: it can\'t change'));
        } else if (current === null) {
            $cell.append($(`<span class="variableUnknown">–</span>`));
        } else if (d.type === 'bool') {
            const $check = $(`<input type="checkbox"/>`).prop('checked', current === 'true');
            $check.on('change', () => setVariable(d, $check.prop('checked') ? 'true' : 'false'));
            $cell.append($check);
        } else {
            const $input = $(`<input type="text" spellcheck="false"/>`).val(current);
            $input.on('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); $input.data('committed', true); setVariable(d, $input.val(), $input); }
                else if (e.key === 'Escape') { $input.val(current).removeClass('invalid').removeAttr('title').blur(); }
                else $input.removeClass('invalid').removeAttr('title');
            });
            // Leaving the box also sets it (unless Enter already did, which re-renders the panel)
            $input.on('blur', () => {
                if ($input.data('committed') || $input.hasClass('invalid') || $input.val() === current) return;
                setVariable(d, $input.val(), $input);
            });
            $cell.append($input);
        }

        if (d.name in overrides) {
            $row.addClass('overridden');
            $row.find('.variableName').attr('title', `You changed ${d.name}. It stays changed, even after you edit, until you restart the story.`);
        }
        $table.find('tbody').append($row);
    }
    $body.append($table);
}

exports.VariablesView = {
    isVisible: isVisible,
    refresh: refresh,
    toggle: (buttonId) => {
        ensurePanel();
        NavView.toggle('#variables-wrapper', buttonId);
        if (isVisible()) {
            render();
            if (!LiveCompiler.isReplaying()) refresh();
        }
    }
};
