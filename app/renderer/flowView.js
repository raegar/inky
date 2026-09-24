const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const InkProject = require('./inkProject.js').InkProject;
const EditorView = require('./editorView.js').EditorView;
const NavView = require('./navView.js').NavView;
const LiveCompiler = require('./liveCompiler.js').LiveCompiler;
const PlayPath = require('./playPath.js').PlayPath;
const dagre = require('@dagrejs/dagre');

function ensurePanel() {
  let $panel = $('#flow-wrapper');
  if ($panel.length) return $panel;
  const $sidebar = $('.sidebar');
  $panel = $('<div class="nav-wrapper hidden" id="flow-wrapper"></div>');

  const $title = $('<nav class="nav-group"><h5 class="nav-group-title">Narrative Flow</h5></nav>');
  const $controls = $('<div class="flowControls"></div>');
  const $filter = $('<input class="flowFilter" type="text" placeholder="Filter..."/>');
  $controls.append($filter);

  const $header = $('<div class="flowHeader"></div>');
  const $tabs = $('<div class="flowTabs"><button class="tab active" data-tab="list">List</button><button class="tab" data-tab="graph">Graph</button></div>');
  $header.append($tabs);

  const $body = $('<div class="flowBody"></div>');
  const $labels = $('<div class="flowLabels"><ul class="flowList"></ul></div>');
  const $graph = $(`<div class="flowGraph">
      <div class="flowLegend">
        <span><i class="key visited"></i>visited</span>
        <span><i class="key current"></i>you are here</span>
        <span><i class="key unreachable"></i>nothing leads here</span>
        <span><i class="key problem">!</i>problem</span>
        <span><i class="key ends"></i>can end</span>
      </div>
      <svg/>
    </div>`).hide();
  $body.append($labels).append($graph);

  $panel.append($title).append($controls).append($header).append($body);
  // Append after existing panels so we don't disturb their order
  $sidebar.append($panel);

  // styles
  if (!document.getElementById('flowPanelStyles')) {
    const style = `
      <style id="flowPanelStyles">
        /* Override base nav-wrapper (which sets right:0) so jQuery width() takes effect */
        #flow-wrapper { position:absolute; top:0; bottom:0; right:auto; overflow:hidden; }
        /* Only display flex when not hidden so we don't override .hidden */
        #flow-wrapper:not(.hidden) { display:flex; flex-direction:column; }
        #flow-wrapper.hidden { display:none; }
        #flow-wrapper .flowControls { padding: 6px 10px; }
        #flow-wrapper .flowControls .flowFilter { width: 100%; box-sizing: border-box; padding: 4px 8px; }
        #flow-wrapper .flowHeader { display:flex; padding: 6px 10px; border-bottom: 1px solid rgba(0,0,0,0.1); }
        #flow-wrapper .flowBody { flex: 1 1 auto; overflow: hidden; }
        #flow-wrapper .flowTabs { display:flex; gap:8px; }
        #flow-wrapper .flowTabs .tab { background:none; border:1px solid rgba(0,0,0,0.15); padding:3px 10px; border-radius:4px; cursor:pointer; color:#444; }
        .dark #flow-wrapper .flowTabs .tab { color:#bbb; border-color: rgba(255,255,255,0.15); }
        #flow-wrapper .flowTabs .tab.active { border-color:#5aa9e6; }
        #flow-wrapper .flowBody { display:flex; gap:8px; padding: 8px 10px 12px; }
        /* List sizes to its content (longest item) up to a cap; graph takes the rest */
        #flow-wrapper .flowLabels { flex: 0 0 auto; width: max-content; min-width: 180px; max-width: 60%; overflow:auto; }
        #flow-wrapper .flowGraph { flex: 1 1 auto; min-width: 200px; overflow:auto; height: 100%; }
        #flow-wrapper .flowGraph { position: relative; }
        #flow-wrapper .flowGraph svg { display:block; }
        #flow-wrapper .flowGraph svg.zooming { cursor: zoom-in; }
        /* In list mode, let the list take the full width (no wasted space) */
        #flow-wrapper.mode-list .flowLabels { flex: 1 1 auto; max-width: none; }
        #flow-wrapper.mode-list .flowGraph { display: none !important; }
        #flow-wrapper .flowList { list-style:none; margin:0; padding:0; }
        #flow-wrapper .flowList .flowRow { display:flex; align-items:center; height:24px; }
        /* Let flow items size to their content so the list column can track intrinsic width */
        #flow-wrapper .flowItem { width:auto; white-space:nowrap; overflow:visible; text-overflow:clip; border-bottom:1px solid rgba(0,0,0,0.06); padding:3px 2px; font-size:12px; }
        .dark #flow-wrapper .flowItem { border-color: rgba(255,255,255,0.06); }
        #flow-wrapper .flowItem .type { color: rgba(0,0,0,0.6); margin-right:6px; text-transform:uppercase; font-size:10px; }
        .dark #flow-wrapper .flowItem .type { color: rgba(255,255,255,0.75); }
        .contrast #flow-wrapper .flowItem .type { color: #ffffff; }
        #flow-wrapper .flowItem a { color:#2a72b5; text-decoration:none; }
        .dark #flow-wrapper .flowItem a { color:#8fd3ff; }
        #flow-wrapper .flowItem a:hover { text-decoration:underline; }
        /* Graph */
        /* Let JS compute explicit pixel size for scrollbars; don't force to container */
        #flow-wrapper .flowGraph svg { width:auto; height:auto; min-height: 0; }
        #flow-wrapper .flowGraph .node rect.box { fill:#2f3542; stroke:#5aa9e6; stroke-width:1; }
        #flow-wrapper .flowGraph .node.stitch rect.box { fill:#4a5468; }
        #flow-wrapper .flowGraph .node.start rect.box { fill:#5aa9e6; stroke:#2a72b5; }
        #flow-wrapper .flowGraph .node.start .label { fill:#0d2236; font-weight:600; }
        #flow-wrapper .flowGraph .node.visited rect.box { fill:#2a72b5; stroke:#9fd0ff; }
        #flow-wrapper .flowGraph .node.current rect.box { stroke:#ffc53d; stroke-width:3; }
        #flow-wrapper .flowGraph .node.unreachable rect.box { stroke:#999; stroke-dasharray:4 3; fill-opacity:0.45; }
        #flow-wrapper .flowGraph .node.unreachable .label { fill-opacity:0.7; }
        #flow-wrapper .flowGraph .node.unresolved rect.box { fill:#5a2a2a; stroke:#e65a5a; stroke-dasharray:4 3; }
        #flow-wrapper .flowGraph .node .badge { fill:#e6a23c; }
        #flow-wrapper .flowGraph .node.has-error .badge { fill:#e65a5a; }
        #flow-wrapper .flowGraph .node .badgeText { fill:#fff; font-size:10px; font-weight:700; pointer-events:none; }
        #flow-wrapper .flowGraph .node .endMark { fill:#888; }
        #flow-wrapper .flowGraph .node:hover rect.box { stroke-width:2; }
        #flow-wrapper .flowGraph .label { fill:#fff; font-size:11px; font-family:system-ui, sans-serif; pointer-events:none; }
        #flow-wrapper .flowGraph .edge { stroke:#999; stroke-width:1.2; fill:none; }
        #flow-wrapper .flowGraph .edge.fallthrough { stroke-dasharray:3 3; }
        #flow-wrapper .flowGraph .edge.taken { stroke:#2a72b5; stroke-width:2.5; }
        #flow-wrapper .flowGraph .arrow { fill:#999; }
        #flow-wrapper .flowGraph .arrow.taken { fill:#2a72b5; }
        #flow-wrapper .flowGraph .edgeLabel rect { fill:#f5f5f4; stroke:rgba(0,0,0,0.12); }
        #flow-wrapper .flowGraph .edgeLabel text { fill:#555; font-size:10px; font-family:system-ui, sans-serif; }
        #flow-wrapper .flowGraph .edgeLabel.taken rect { stroke:#2a72b5; }
        #flow-wrapper .flowGraph .edgeLabel.taken text { fill:#2a72b5; }
        .dark #flow-wrapper .flowGraph .edgeLabel rect, .contrast #flow-wrapper .flowGraph .edgeLabel rect { fill:#2a2a2a; stroke:rgba(255,255,255,0.15); }
        .dark #flow-wrapper .flowGraph .edgeLabel text, .contrast #flow-wrapper .flowGraph .edgeLabel text { fill:#ccc; }
        .dark #flow-wrapper .flowGraph .edge.taken, .contrast #flow-wrapper .flowGraph .edge.taken { stroke:#6cb8f0; }
        .dark #flow-wrapper .flowGraph .arrow.taken, .contrast #flow-wrapper .flowGraph .arrow.taken { fill:#6cb8f0; }
        /* Legend */
        #flow-wrapper .flowLegend { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:10px; color:#777; padding:0 2px 8px; }
        #flow-wrapper .flowLegend span { display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
        #flow-wrapper .flowLegend .key { display:inline-block; width:14px; height:10px; border-radius:2px; box-sizing:border-box; font-style:normal; }
        #flow-wrapper .flowLegend .key.visited { background:#2a72b5; border:1px solid #9fd0ff; }
        #flow-wrapper .flowLegend .key.current { background:#2a72b5; border:2px solid #ffc53d; }
        #flow-wrapper .flowLegend .key.unreachable { border:1px dashed #999; }
        #flow-wrapper .flowLegend .key.problem { width:10px; border-radius:50%; background:#e6a23c; color:#fff; font-size:8px; font-weight:700; line-height:10px; text-align:center; }
        #flow-wrapper .flowLegend .key.ends { height:4px; background:#888; }
        .dark #flow-wrapper .flowLegend, .contrast #flow-wrapper .flowLegend { color:#aaa; }
      </style>`;
    $('head').append(style);
  }

  // override rules to support independent show/hide toggles
  if (!document.getElementById('flowPanelToggleStyles')) {
    const toggleStyle = `
      <style id="flowPanelToggleStyles">
        #flow-wrapper .flowLabels { display: none; }
        #flow-wrapper .flowGraph { display: none; }
        #flow-wrapper.show-list .flowLabels { display: block; }
        #flow-wrapper.show-graph .flowGraph { display: block; }
        #flow-wrapper.show-list:not(.show-graph) .flowLabels { flex: 1 1 auto; max-width: none; }
        #flow-wrapper.show-graph:not(.show-list) .flowGraph { flex: 1 1 auto; min-width: 0; }
      </style>`;
    $('head').append(toggleStyle);
  }

  // tab logic: independent toggles
  $tabs.on('click', '.tab', (e) => {
    const $btn = $(e.currentTarget);
    const tab = $btn.data('tab');
    const isActive = $btn.hasClass('active');
    if (tab === 'graph') {
      if (isActive) {
        $panel.removeClass('show-graph');
        $btn.removeClass('active');
        $graph.hide();
      } else {
        $panel.addClass('show-graph');
        $btn.addClass('active');
        $graph.show();
        renderGraph($graph.find('svg'));
        refreshPlayPath();
        try {
          // Only ensure width when Flow is the sole visible panel
          const visiblePanels = $('.nav-wrapper').not('.hidden');
          if (visiblePanels.length === 1 && visiblePanels.is('#flow-wrapper')) {
            const listW = $labels.outerWidth() || 180;
            const minGraphWidth = 560; // px budget for a readable graph
            const desired = listW + minGraphWidth;
            NavView.ensureWidth(desired);
          }
        } catch(_) {}
      }
    } else { // list
      if (isActive) {
        $panel.removeClass('show-list');
        $btn.removeClass('active');
        $labels.hide();
      } else {
        $panel.addClass('show-list');
        $btn.addClass('active');
        $labels.show();
      }
    }
  });

  // Zoom the graph with Ctrl/Cmd + mouse wheel
  $graph.on('wheel', (evt) => {
    const e = evt.originalEvent || evt;
    if (!e.ctrlKey && !e.metaKey) return; // require modifier to zoom
    evt.preventDefault();
    try {
      const svg = $graph.find('svg');
      if (!svg.length) return;
      const delta = (e.deltaY || 0);
      const factor = delta < 0 ? 1.1 : 0.9;
      setZoomScale(getZoomScale() * factor);
      renderGraph(svg);
    } catch(_){}
  });

  // start with list visible, graph hidden
  $panel.addClass('show-list');
  $tabs.find('.tab[data-tab="list"]').addClass('active');

  // filter
  $filter.on('input', () => populateList($panel));

  return $panel;
}

// Scans every ink file's tokens for knots, stitches and diverts. Flows are identified by
// their full ink path ("knot" or "knot.stitch"), since stitch names are only unique
// within their knot. Diverts outside any knot come from the start of the story.
const START = '__start__';

function scanProject() {
  const project = InkProject.currentProject;
  const flows = [];                  // { id, name, type: 'Knot'|'Stitch'|'Function', file, row, ends, hasOwnContent, firstStitch }
  const diverts = [];                // { from, target, knot, label, file, row }
  const references = [];             // diverts stored in variables: { from, target, knot }
  const labels = new Map();          // "knot.label" / "knot.stitch.label" -> owning flow id
  const variables = new Set();       // names that can hold a divert target (VAR, temp, parameters)
  if (!project) return { flows, diverts, references, labels, variables };

  const TokenIterator = ace.require('ace/token_iterator').TokenIterator;

  (project.files || []).forEach(f => {
    try {
      const session = f.getAceSession();
      const it = new TokenIterator(session, 0, 0);
      if (it.getCurrentToken() === undefined) it.stepForward();
      let knot = null, stitch = null, current = null, knotFlow = null, inFunction = false;
      let prevToken = null, choiceLabel = null, lastRow = -1;

      const addParameters = (row) => {
        const params = /\(([^)]*)\)/.exec(session.getLine(row));
        if (!params) return;
        params[1].split(',').forEach(p => {
          const name = p.replace(/->|\bref\b/g, '').trim();
          if (name) variables.add(name);
        });
      };

      // The text of a choice as the player sees it: stops at the closing ] (text after it
      // is only printed once chosen), or at a divert or tag
      const choiceTextOnRow = (row) => {
        let text = '';
        for (const t of session.getTokens(row)) {
          if (/divert|^tag/.test(t.type)) break;
          if (t.type === 'choice.weaveBracket') { if (t.value.indexOf(']') !== -1) break; continue; }
          if (/bullets|label|comment|^logic/.test(t.type)) continue;
          text += t.value;
        }
        return text.replace(/\s+/g, ' ').trim();
      };

      for (let tok = it.getCurrentToken(); tok; tok = it.stepForward()) {
        const type = tok.type || '';
        const row = it.getCurrentTokenRow();

        // A choice's diverts carry its text, until the next choice or gather
        if (row !== lastRow) {
          lastRow = row;
          const rowTypes = session.getTokens(row).map(t => t.type);
          if (rowTypes.some(t => t === 'choice.bullets')) choiceLabel = choiceTextOnRow(row);
          else if (rowTypes.some(t => t === 'gather.bullets')) choiceLabel = null;
        }

        if (type.indexOf('.knot.declaration') !== -1 && type.indexOf('.name') !== -1) {
          knot = tok.value; stitch = null; choiceLabel = null;
          inFunction = session.getTokens(row).some(t => t.type === 'flow.knot.declaration.function');
          current = { id: knot, name: knot, type: inFunction ? 'Function' : 'Knot', file: f, row, ends: false, hasOwnContent: false, firstStitch: null };
          knotFlow = current;
          flows.push(current);
          addParameters(row);
        }
        else if (type.indexOf('.stitch.declaration') !== -1 && type.indexOf('.name') !== -1) {
          stitch = tok.value; choiceLabel = null;
          const id = knot ? `${knot}.${stitch}` : stitch;
          current = { id, name: stitch, type: inFunction ? 'Function' : 'Stitch', file: f, row, ends: false };
          if (knotFlow && !knotFlow.firstStitch) knotFlow.firstStitch = id;
          flows.push(current);
          addParameters(row);
        }
        else if (/\.label\.name$/.test(type) && current) {
          if (knot) labels.set(`${knot}.${tok.value}`, current.id);
          if (knot && stitch) labels.set(`${knot}.${stitch}.${tok.value}`, current.id);
          if (!labels.has(tok.value)) labels.set(tok.value, current.id);
        }
        else if (type === 'var-decl.name' && prevToken && prevToken.type === 'var-decl.keyword') {
          variables.add(tok.value);
        }
        else if (type === 'var-decl.name' && prevToken && prevToken.value.indexOf('->') !== -1) {
          references.push({ from: current ? current.id : START, target: tok.value, knot });
        }
        else if (type.indexOf('logic') === 0) {
          const temp = /\btemp\s+([A-Za-z_]\w*)/.exec(tok.value);
          if (temp) variables.add(temp[1]);
          const re = /->\s*([A-Za-z_][\w.]*)/g;
          let m;
          while ((m = re.exec(tok.value))) references.push({ from: current ? current.id : START, target: m[1], knot });
        }
        else if (type === 'divert.target' && tok.value && !inFunction) {
          diverts.push({ from: current ? current.id : START, target: tok.value.trim(), knot, label: choiceLabel, file: f, row });
        }
        else if (type === 'divert.to-special' && current) {
          current.ends = true;
        }

        // Content in a knot before its first stitch means diverting to the knot doesn't
        // run straight on into that stitch
        if (knotFlow && !stitch && current === knotFlow && tok.value.trim() && !/^flow\.|comment/.test(type)) {
          knotFlow.hasOwnContent = true;
        }
        if (tok.value.trim()) prevToken = tok;
      }
    } catch (e) { console.error('FlowView.scanProject', e); }
  });
  return { flows, diverts, references, labels, variables };
}

function collectBeats() {
  const { flows, diverts } = scanProject();
  const beats = [];
  flows.forEach(fl => beats.push({ type: fl.type.toLowerCase(), name: fl.name, file: fl.file, row: fl.row }));
  diverts.forEach(d => beats.push({ type: 'divert', name: `${d.from === START ? 'start' : d.from}→${d.target}`, file: d.file, row: d.row }));

  // stable sort: by file then row
  beats.sort((a,b) => {
    const fa = a.file ? a.file.relativePath() : '';
    const fb = b.file ? b.file.relativePath() : '';
    if (fa !== fb) return fa.localeCompare(fb);
    return a.row - b.row;
  });
  return beats;
}

function populateList($panel) {
  const $list = $panel.find('.flowList');
  const filterText = ($panel.find('.flowFilter').val() || '').toLowerCase();
  const beats = collectBeats();
  $list.empty();
  beats.forEach(b => {
    if (filterText && !(b.name && b.name.toLowerCase().includes(filterText))) return;
    const fileLabel = b.file ? b.file.relativePath() : '';
    // Keep file path as a tooltip only to reduce visual clutter
    const $li = $(`<li class="flowRow"><div class="flowItem"><span class="type"></span> <a href="#"></a></div></li>`);
    $li.find('.type').text(b.type);
    $li.find('a').text(b.name || '(untitled)').attr('title', fileLabel);
    $li.find('a').on('click', (e) => {
      e.preventDefault();
      if (b.file) { InkProject.currentProject.showInkFile(b.file); EditorView.gotoLine((b.row||0)+1); }
    });
    $list.append($li);
  });
}

// The knot or stitch containing a line of source, by graph id
function flowIdAt(inkFile, row) {
  const symbols = inkFile && inkFile.symbols.flowAtPos({ row, column: 0 });
  if (!symbols) return null;
  if (symbols.Stitch && symbols.Knot) return `${symbols.Knot.name}.${symbols.Stitch.name}`;
  if (symbols.Knot) return symbols.Knot.name;
  return null;
}

function computeGraph() {
  const { flows, diverts, references, labels, variables } = scanProject();
  const nodesById = new Map();
  flows.forEach(fl => { if (fl.type !== 'Function' && !nodesById.has(fl.id)) nodesById.set(fl.id, Object.assign({ issues: [] }, fl)); });
  if (diverts.some(d => d.from === START)) {
    nodesById.set(START, { id: START, name: 'Start', type: 'Start', file: null, row: 0, issues: [] });
  }

  // Finds the flow a divert leads to. Returns its id, null for a divert target chosen
  // at runtime (a variable), or undefined if nothing matches.
  const resolveTarget = (target, knot) => {
    if (knot && nodesById.has(`${knot}.${target}`)) return `${knot}.${target}`;          // stitch in the same knot
    if (nodesById.has(target) && target !== START) return target;                        // knot, or knot.stitch
    if (knot && labels.has(`${knot}.${target}`)) return labels.get(`${knot}.${target}`); // label in the same knot
    if (labels.has(target)) return labels.get(target);                                  // knot.label, knot.stitch.label
    if (variables.has(target)) return null;
    return undefined;
  };

  const edgesByKey = new Map();
  const addEdge = (from, to, label, kind) => {
    if (to === from) return;
    const key = `${from}->${to}`;
    if (!edgesByKey.has(key)) edgesByKey.set(key, { from, to, labels: [], kind });
    const edge = edgesByKey.get(key);
    if (label && edge.labels.indexOf(label) === -1) edge.labels.push(label);
    if (kind === 'divert') edge.kind = 'divert';
  };

  diverts.forEach(d => {
    if (!nodesById.has(d.from)) return;       // e.g. inside a function
    let to = resolveTarget(d.target, d.knot);
    if (to === null) return;
    if (to === undefined) {
      // Doesn't exist (the compiler reports it too): show it as a red node
      to = `?${d.target}`;
      if (!nodesById.has(to)) nodesById.set(to, { id: to, name: d.target, type: 'Unresolved', file: null, row: 0, issues: [] });
    }
    addEdge(d.from, to, d.label, 'divert');
  });

  // Diverting to a knot with nothing before its first stitch runs straight into that stitch
  flows.forEach(fl => {
    if (fl.type === 'Knot' && fl.firstStitch && !fl.hasOwnContent && nodesById.has(fl.firstStitch)) addEdge(fl.id, fl.firstStitch, null, 'fallthrough');
  });
  const edges = Array.from(edgesByKey.values());

  // Which flows can be reached from the start, following diverts and diverts stored in variables
  const next = new Map();
  const link = (from, to) => { if (!next.has(from)) next.set(from, []); next.get(from).push(to); };
  edges.forEach(e => link(e.from, e.to));
  references.forEach(r => { const to = resolveTarget(r.target, r.knot); if (to) link(r.from, to); });
  const reachable = new Set([START]);
  const queue = [START];
  while (queue.length) {
    (next.get(queue.shift()) || []).forEach(to => { if (!reachable.has(to)) { reachable.add(to); queue.push(to); } });
  }
  nodesById.forEach(n => { n.unreachable = (n.type === 'Knot' || n.type === 'Stitch') && !reachable.has(n.id); });

  // Compiler problems (e.g. "loose end" warnings where the story runs out) inside each flow
  const project = InkProject.currentProject;
  LiveCompiler.getIssues().forEach(issue => {
    if (issue.type === 'TODO' || !issue.filename) return;
    const id = flowIdAt(project && project.inkFileWithRelativePath(issue.filename), issue.lineNumber - 1);
    if (id && nodesById.has(id)) nodesById.get(id).issues.push(issue);
  });

  markPlayPath(nodesById, edgesByKey);

  const nodes = Array.from(nodesById.values());
  return { nodes, edges };
}

// Marks the knots the current playthrough has been through, the edges it took, and where
// it is now. Knots that only offer choices print no text, so they're worked out from the
// choice the player picked.
function markPlayPath(nodesById, edgesByKey) {
  const turns = PlayPath.summary();
  let last = START;
  const visit = (id) => {
    if (!id || id === last || !nodesById.has(id)) return;
    const key = `${last}->${id}`;
    if (edgesByKey.has(key)) edgesByKey.get(key).taken = true;
    nodesById.get(id).visited = true;
    last = id;
  };
  turns.forEach((turn, i) => {
    const chosen = i > 0 ? turns[i - 1].chosen : null;
    if (chosen) {
      const first = turn.flows[0];
      const leadsToFirst = (e) => first && (e.to === first || first.indexOf(e.to + '.') === 0);
      const candidates = Array.from(edgesByKey.values()).filter(e => e.labels.indexOf(chosen) !== -1);
      const edge = candidates.find(e => e.from === last && (!first || leadsToFirst(e)))
        || candidates.find(e => leadsToFirst(e))
        || candidates.find(e => e.from === last)
        || (!first ? candidates[0] : null);
      if (edge) { visit(edge.from); visit(edge.to); }
    }
    turn.flows.forEach(visit);
  });
  if (last !== START && nodesById.has(last)) nodesById.get(last).current = true;
}

// Measures text for sizing nodes and labels
let measureContext = null;
function textWidth(text, font) {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG_NS, name);
  Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
  if (text !== undefined) el.textContent = text;
  return el;
}

// Smooth path through dagre's edge points
function edgePath(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += ` Q ${points[i].x} ${points[i].y} ${mid.x} ${mid.y}`;
  }
  const end = points[points.length - 1];
  return d + ` L ${end.x} ${end.y}`;
}

function nodeTooltip(n) {
  const lines = [n.type === 'Stitch' ? n.id : n.name];
  if (n.type === 'Start') lines[0] = 'The start of the story';
  if (n.file) lines.push(`${n.file.relativePath()}:${n.row + 1}`);
  if (n.type === 'Unresolved') lines.push('Not found: nothing in your story has this name');
  if (n.current) lines.push('The story is here now');
  else if (n.visited) lines.push('Visited in this playthrough');
  if (n.unreachable) lines.push('Nothing leads here: no divert or choice goes to it');
  if (n.ends) lines.push('Can end the story (-> END or -> DONE)');
  n.issues.forEach(i => lines.push(`${i.type === 'ERROR' || i.type === 'RUNTIME ERROR' ? 'Error' : 'Warning'}: ${i.message}`));
  return lines.join('\n');
}

const NODE_FONT = '11px system-ui, sans-serif';
const LABEL_FONT = '10px system-ui, sans-serif';

function renderGraph($svg) {
  const data = computeGraph();
  const svg = $svg[0];
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 18, ranksep: 36, edgesep: 10, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));

  data.nodes.forEach(n => {
    n.label = truncate(n.type === 'Stitch' ? n.id : n.name, 26);
    const badge = n.issues.length ? 16 : 0;
    g.setNode(n.id, { width: Math.max(56, Math.ceil(textWidth(n.label, NODE_FONT)) + 20 + badge), height: 24 });
  });
  data.edges.forEach(e => {
    e.label = e.labels.length ? truncate(e.labels.join(' / '), 24) : '';
    const opts = e.label ? { width: Math.ceil(textWidth(e.label, LABEL_FONT)) + 8, height: 14, labelpos: 'c' } : {};
    g.setEdge(e.from, e.to, opts);
  });
  dagre.layout(g);

  const defs = svgEl('defs');
  [['flowArrow', 'arrow'], ['flowArrowTaken', 'arrow taken']].forEach(([id, cls]) => {
    // Fixed size, rather than scaling with the line's thickness
    const marker = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: cls }));
    defs.appendChild(marker);
  });
  svg.appendChild(defs);
  const viewport = svgEl('g', { id: 'viewport' });
  svg.appendChild(viewport);

  // Edges, with the choice text that leads along them
  data.edges.forEach(e => {
    const laidOut = g.edge(e.from, e.to);
    if (!laidOut || !laidOut.points) return;
    const classes = ['edge', e.kind, e.taken ? 'taken' : ''].join(' ');
    viewport.appendChild(svgEl('path', {
      class: classes, d: edgePath(laidOut.points),
      'marker-end': `url(#${e.taken ? 'flowArrowTaken' : 'flowArrow'})`,
      'data-from': e.from, 'data-to': e.to
    }));
    if (e.label) {
      const lg = svgEl('g', { class: 'edgeLabel' + (e.taken ? ' taken' : ''), transform: `translate(${laidOut.x},${laidOut.y})` });
      const w = Math.ceil(textWidth(e.label, LABEL_FONT)) + 8;
      lg.appendChild(svgEl('title', {}, e.labels.join('\n')));
      lg.appendChild(svgEl('rect', { x: -w / 2, y: -7, width: w, height: 14, rx: 3 }));
      lg.appendChild(svgEl('text', { x: 0, y: 3.5, 'text-anchor': 'middle' }, e.label));
      viewport.appendChild(lg);
    }
  });

  // Nodes
  data.nodes.forEach(n => {
    const box = g.node(n.id);
    const classes = ['node', n.type.toLowerCase(), n.visited ? 'visited' : '', n.current ? 'current' : '',
      n.unreachable ? 'unreachable' : '', n.ends ? 'ends' : '',
      n.issues.some(i => /ERROR/.test(i.type)) ? 'has-error' : (n.issues.length ? 'has-warning' : '')].join(' ');
    const ng = svgEl('g', { class: classes, transform: `translate(${box.x - box.width / 2},${box.y - box.height / 2})`, 'data-id': n.id });
    ng.appendChild(svgEl('title', {}, nodeTooltip(n)));
    ng.appendChild(svgEl('rect', { class: 'box', width: box.width, height: box.height, rx: n.type === 'Start' ? 12 : 4 }));
    ng.appendChild(svgEl('text', { class: 'label', x: 10, y: box.height / 2 + 4 }, n.label));
    if (n.issues.length) {
      ng.appendChild(svgEl('circle', { class: 'badge', cx: box.width - 10, cy: box.height / 2, r: 6 }));
      ng.appendChild(svgEl('text', { class: 'badgeText', x: box.width - 10, y: box.height / 2 + 3.5, 'text-anchor': 'middle' }, '!'));
    }
    if (n.ends) ng.appendChild(svgEl('rect', { class: 'endMark', x: box.width / 2 - 10, y: box.height, width: 20, height: 4, rx: 2 }));
    if (n.file) {
      ng.style.cursor = 'pointer';
      ng.addEventListener('click', () => {
        try { InkProject.currentProject.showInkFile(n.file); EditorView.gotoLine((n.row || 0) + 1); } catch (_) {}
      });
    }
    viewport.appendChild(ng);
  });

  // Size the svg to everything drawn (edges that loop back can curve outside the
  // nodes' area), scaled by the zoom level, so it scrolls
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x, y) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  };
  g.nodes().forEach(id => { const n = g.node(id); include(n.x - n.width / 2, n.y - n.height / 2); include(n.x + n.width / 2, n.y + n.height / 2 + 6); });
  g.edges().forEach(e => {
    const edge = g.edge(e);
    (edge.points || []).forEach(p => include(p.x, p.y));
    if (edge.width) { include(edge.x - edge.width / 2, edge.y - 7); include(edge.x + edge.width / 2, edge.y + 7); }
  });
  if (!isFinite(bounds.minX)) { bounds.minX = bounds.minY = 0; bounds.maxX = bounds.maxY = 1; }
  const margin = 12;
  const contentWidth = bounds.maxX - bounds.minX + margin * 2;
  const contentHeight = bounds.maxY - bounds.minY + margin * 2;
  svg.setAttribute('viewBox', `${bounds.minX - margin} ${bounds.minY - margin} ${contentWidth} ${contentHeight}`);
  const scale = getZoomScale();
  const w = Math.max(1, Math.round(contentWidth * scale));
  const h = Math.max(1, Math.round(contentHeight * scale));
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';
}

// Simple module-scoped zoom state/helpers
let __flowZoomScale = 1;
function setZoomScale(v){ __flowZoomScale = Math.max(0.5, Math.min(3, v)); }
function getZoomScale(){ return __flowZoomScale; }

function isGraphVisible() {
  return $('#flow-wrapper .flowGraph').is(':visible');
}

// Works out the playthrough's route (if the story is waiting for a choice, so inklecate
// can answer), then redraws the graph
function refreshPlayPath() {
  if (!isGraphVisible()) return;
  const redraw = () => { if (isGraphVisible()) renderGraph($('#flow-wrapper .flowGraph svg')); };
  if (LiveCompiler.isReplaying()) redraw();
  else PlayPath.resolve(redraw);
}

exports.FlowView = {
  _refreshTimer: null,
  _doRefresh: function() {
    const $panel = ensurePanel();
    // Always update the list
    try { populateList($panel); } catch(e) { console.error('FlowView.populateList', e); }
    // Update graph only if its section is visible
    try {
      const $graph = $panel.find('.flowGraph');
      if ($graph.is(':visible')) {
        renderGraph($graph.find('svg'));
      }
    } catch(e) { console.error('FlowView.renderGraph', e); }
  },
  requestRefresh: function() {
    // Debounce rapid edits
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._doRefresh();
    }, 250);
  },
  refreshNow: function() {
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
    this._doRefresh();
  },
  isGraphVisible: isGraphVisible,
  // The story has moved on (a turn finished, or a replay completed)
  playPathChanged: function() {
    if (!isGraphVisible()) return;
    try { renderGraph($('#flow-wrapper .flowGraph svg')); } catch(e) { console.error('FlowView.renderGraph', e); }
  },
  toggle: function(buttonId){
    const $panel = ensurePanel();
    // Refresh immediately when toggled open/closed
    this.refreshNow();
    NavView.toggle('#flow-wrapper', buttonId);
    // If graph is the active tab, ensure a reasonable width
    const $graph = $('#flow-wrapper .flowGraph');
    if ($graph.is(':visible')) {
      refreshPlayPath();
      try {
        const visiblePanels = $('.nav-wrapper').not('.hidden');
        if (visiblePanels.length === 1 && visiblePanels.is('#flow-wrapper')) {
          const listW = $('#flow-wrapper .flowLabels').outerWidth() || 180;
          const minGraphWidth = 560;
          const desired = listW + minGraphWidth;
          NavView.ensureWidth(desired);
        }
      } catch(_) {}
    }
  }
};
