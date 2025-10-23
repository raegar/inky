const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const InkProject = require('./inkProject.js').InkProject;
const EditorView = require('./editorView.js').EditorView;
const NavView = require('./navView.js').NavView;

function collectSymbols() {
  const project = InkProject.currentProject;
  if (!project) return [];

  const items = [];
  const files = project.files || [];

  const walk = (symbol, file) => {
    if (!symbol) return;
    if (symbol.flowType && (symbol.flowType.name === 'Knot' || symbol.flowType.name === 'Stitch')) {
      items.push({
        type: symbol.flowType.name,
        name: symbol.name,
        row: symbol.row,
        file
      });
    }
    if (symbol.innerSymbols) {
      for (const key of Object.keys(symbol.innerSymbols)) {
        walk(symbol.innerSymbols[key], file);
      }
    }
  };

  files.forEach(f => {
    try {
      const syms = f.symbols.getSymbols();
      if (syms) {
        for (const key of Object.keys(syms)) {
          walk(syms[key], f);
        }
      }
    } catch (_) {}
  });

  // Sort: Knots first, then stitches; then by file then name
  items.sort((a,b) => {
    const typeRank = (t) => t === 'Knot' ? 0 : 1;
    if (typeRank(a.type) !== typeRank(b.type)) return typeRank(a.type)-typeRank(b.type);
    const fa = a.file ? a.file.relativePath() : '';
    const fb = b.file ? b.file.relativePath() : '';
    if (fa !== fb) return fa.localeCompare(fb);
    return a.name.localeCompare(b.name);
  });

  return items;
}

function computeGraph() {
  const project = InkProject.currentProject;
  if (!project) return { nodes: [], edges: [] };

  const TokenIterator = ace.require('ace/token_iterator').TokenIterator;
  const nodesById = new Map();
  const nodesByName = new Map();
  const edges = [];

  const makeId = (file, name) => `${file ? file.relativePath() : '?'}::${name}`;
  const ensureNode = (file, name, type, row) => {
    const id = makeId(file, name);
    if (!nodesById.has(id)) nodesById.set(id, { id, name, type, file, row: row || 0 });
    nodesByName.set(name, nodesById.get(id));
    return nodesById.get(id);
  };

  (project.files || []).forEach(f => {
    try {
      const session = f.getAceSession();
      const it = new TokenIterator(session, 0, 0);
      if (it.getCurrentToken() === undefined) it.stepForward();

      const flowTypes = [
        { name: 'Knot', code: '.knot.declaration', level: 1 },
        { name: 'Stitch', code: '.stitch.declaration', level: 2 }
      ];

      const stack = [];
      const top = () => (stack.length ? stack[stack.length - 1] : null);

      for (let tok = it.getCurrentToken(); tok; tok = it.stepForward()) {
        if (tok.type && tok.type.indexOf('.name') !== -1) {
          const t = flowTypes.find(ft => tok.type.indexOf(ft.code) !== -1);
          if (t) {
            while (top() && t.level <= top().level) stack.pop();
            const sym = { level: t.level, type: t.name, name: tok.value, row: it.getCurrentTokenRow(), file: f };
            stack.push(sym);
            ensureNode(f, sym.name, sym.type, sym.row);
            continue;
          }
        }
        if (tok.type === 'divert.target' && tok.value && tok.value.trim().length > 0) {
          const src = top();
          if (src && (src.type === 'Knot' || src.type === 'Stitch')) {
            const fromNode = ensureNode(src.file, src.name, src.type, src.row);
            edges.push({ from: fromNode.id, toName: tok.value.trim() });
          }
        }
      }
    } catch (_) { }
  });

  edges.forEach(e => {
    const t = nodesByName.get(e.toName);
    if (t) e.to = t.id; else e.to = ensureNode(null, e.toName, 'Unresolved', 0).id;
  });

  const nodes = Array.from(nodesById.values());
  nodes.sort((a, b) => {
    const fa = a.file ? a.file.relativePath() : '~unresolved';
    const fb = b.file ? b.file.relativePath() : '~unresolved';
    if (fa !== fb) return fa.localeCompare(fb);
    if (a.row !== b.row) return a.row - b.row;
    const rank = t => (t === 'Knot' ? 0 : t === 'Stitch' ? 1 : 2);
    return rank(a.type) - rank(b.type);
  });

  return { nodes, edges };
}

function buildDrawer(items) {
  // If already open, toggle (close)
  const existing = document.getElementById('flowDrawer');
  if (existing) { existing.remove(); return; }

  const $drawer = $('<div id="flowDrawer" class="flowDrawer"></div>');
  const $header = $('<div class="flowHeader"><span>Narrative Flow</span><button class="close">×</button></div>');
  const $body = $('<div class="flowBody"></div>');
  const $tabs = $('<div class="flowTabs"><button class="tab active" data-tab="list">List</button><button class="tab" data-tab="graph">Graph</button></div>');

  const $list = $('<ul class="flowList"></ul>');
  const $graph = $('<div class="flowGraph"><svg/></div>').hide();
  items.forEach(it => {
    const fileLabel = it.file ? it.file.relativePath() : '';
    const $li = $(`<li class="flowItem ${it.type.toLowerCase()}"><span class="type">${it.type}</span> <a href="#">${it.name}</a> <span class="file">${fileLabel}</span></li>`);
    $li.find('a').on('click', (e) => {
      e.preventDefault();
      if (it.file) {
        InkProject.currentProject.showInkFile(it.file);
        EditorView.gotoLine(it.row + 1);
      }
      $drawer.remove();
    });
    $list.append($li);
  });

  $drawer.append($tabs);
  $body.append($list).append($graph);
  $drawer.append($header).append($body);

  $header.find('button.close').on('click', () => $drawer.remove());
  $(document).on('keydown.flowDrawer', (e) => { if (e.key === 'Escape') { $drawer.remove(); $(document).off('keydown.flowDrawer'); } });
  $tabs.on('click', '.tab', (e) => {
    const tab = $(e.currentTarget).data('tab');
    $tabs.find('.tab').removeClass('active');
    $(e.currentTarget).addClass('active');
    if (tab === 'graph') {
      $list.hide();
      $graph.show();
      renderGraph($graph.find('svg'));
    } else {
      $graph.hide();
      $list.show();
    }
  });

  // Drawer styles
  const style = `
    <style id="flowViewStyles">
      .flowDrawer { position: fixed; top: 0; bottom: 0; left: 0; width: 320px; background:#222; color:#fff; z-index: 9999; box-shadow: 4px 0 20px rgba(0,0,0,0.4); transform: translateX(-100%); transition: transform 180ms ease-out; display:flex; flex-direction:column; }
      .flowDrawer.show { transform: translateX(0); }
      .flowHeader { display:flex; justify-content:space-between; align-items:center; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.15); font-weight:600; }
      .flowHeader button.close { background:none; border:none; color:#fff; font-size:20px; cursor:pointer; }
      .flowBody { padding: 8px 14px 12px; overflow:auto; }
      .flowList { list-style:none; margin:0; padding:0; }
      .flowItem { padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06); }
      .flowItem .type { display:inline-block; min-width: 56px; font-size: 11px; color:#aaa; text-transform:uppercase; }
      .flowItem a { color:#8fd3ff; text-decoration:none; }
      .flowItem a:hover { text-decoration:underline; }
      .flowItem .file { float:right; color:#888; font-size:11px; }
    </style>`;
  if (!document.getElementById('flowViewStyles')) $('head').append(style);
  if (!document.getElementById('flowViewGraphStyles')) {
    const graphStyle = `
      <style id="flowViewGraphStyles">
        .flowTabs { display:flex; gap:8px; padding:6px 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .flowTabs .tab { background: none; color:#bbb; border: 1px solid rgba(255,255,255,0.15); padding: 3px 10px; border-radius: 4px; cursor: pointer; }
        .flowTabs .tab.active { color:#fff; border-color:#5aa9e6; }
        .flowGraph { width:100%; height:100%; overflow:auto; }
        .flowGraph svg { width: 1000px; height: 100%; min-height: 600px; }
        .flowGraph .lane { fill: rgba(255,255,255,0.03); }
        .flowGraph .node { fill: #333; stroke: #5aa9e6; stroke-width: 1; }
        .flowGraph .node.unresolved { stroke: #e65a5a; }
        .flowGraph .label { fill: #fff; font-size: 12px; pointer-events: none; }
        .flowGraph .edge { stroke: #888; stroke-width: 1; fill: none; }
      </style>`;
    $('head').append(graphStyle);
  }

  $('body').append($drawer);
  // trigger slide-in
  requestAnimationFrame(() => $drawer.addClass('show'));
}

function renderGraph($svg) {
  const data = computeGraph();
  const svg = $svg[0];
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const nodeW = 160, nodeH = 26, vGap = 18;
  const baseX = 24, laneSpacing = 200;

  // Build adjacency
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const incoming = new Map();
  const outgoing = new Map();
  data.nodes.forEach(n => { incoming.set(n.id, []); outgoing.set(n.id, []); });
  data.edges.forEach(e => {
    if (incoming.has(e.to)) incoming.get(e.to).push(e.from);
    if (outgoing.has(e.from)) outgoing.get(e.from).push(e.to);
  });

  // Lane assignment (greedy, git-style)
  const laneOf = new Map();
  const preferredLane = new Map();
  let maxLane = -1;

  // vertical order by appearance
  data.nodes.forEach((n, idx) => {
    n.y = 20 + idx * (nodeH + vGap);
    const preds = (incoming.get(n.id) || []).map(id => laneOf.get(id)).filter(v => v !== undefined);
    let lane = preferredLane.has(n.id) ? preferredLane.get(n.id)
             : preds.length === 1 ? preds[0]
             : preds.length > 1 ? Math.min.apply(null, preds)
             : 0;
    // ensure lane is free index
    if (lane === undefined || lane < 0) lane = 0;
    // if lane already used by another branch preference, keep as is; we don't need exclusive lanes per row
    laneOf.set(n.id, lane);
    if (lane > maxLane) maxLane = lane;

    // Allocate preferred lanes for children: first on same lane, others to new lanes to the right
    const outs = outgoing.get(n.id) || [];
    outs.forEach((toId, i) => {
      if (!preferredLane.has(toId)) {
        const targetLane = i === 0 ? lane : (maxLane + 1 + (i - 1));
        preferredLane.set(toId, targetLane);
        if (targetLane > maxLane) maxLane = targetLane;
      }
    });
  });

  // Compute x positions and draw lane backgrounds
  const lanesCount = maxLane + 1;
  for (let li = 0; li < lanesCount; li++) {
    const laneRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    laneRect.setAttribute('x', `${baseX + li * laneSpacing - 10}`);
    laneRect.setAttribute('y', `0`);
    laneRect.setAttribute('width', `${laneSpacing}`);
    laneRect.setAttribute('height', `100%`);
    laneRect.setAttribute('class', 'lane');
    svg.appendChild(laneRect);
  }

  data.nodes.forEach(n => {
    n.x = baseX + (laneOf.get(n.id) || 0) * laneSpacing;
  });

  // edges under nodes
  data.edges.forEach(e => {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) return;
    const x1 = a.x + nodeW, y1 = a.y + nodeH/2;
    const x2 = b.x, y2 = b.y + nodeH/2;
    // Orthogonal elbows with midpoint column
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'edge');
    path.setAttribute('d', `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
    svg.appendChild(path);
  });

  // nodes
  data.nodes.forEach(n => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.style.cursor = 'pointer';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.setAttribute('width', `${nodeW}`);
    rect.setAttribute('height', `${nodeH}`);
    rect.setAttribute('class', `node ${n.type === 'Unresolved' ? 'unresolved' : ''}`);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '6');
    text.setAttribute('y', `${nodeH/2 + 4}`);
    text.setAttribute('class', 'label');
    text.textContent = n.name;

    g.appendChild(rect);
    g.appendChild(text);
    svg.appendChild(g);

    g.addEventListener('click', () => {
      if (n.file) {
        try { InkProject.currentProject.showInkFile(n.file); EditorView.gotoLine((n.row||0)+1); } catch (_) {}
      }
    });
  });
}

exports.FlowView = {
  show: function() {
    // Build or reuse a sidebar panel so it resizes like the Knot Browser
    const $sidebar = $('.sidebar');
    let $panel = $('#flow-wrapper');
    if ($panel.length === 0) {
      $panel = $('<div class="nav-wrapper hidden" id="flow-wrapper"></div>');
      const $title = $('<nav class="nav-group"><h5 class="nav-group-title">Narrative Flow</h5></nav>');
      const $tabs = $('<div class="flowTabs"><button class="tab active" data-tab="list">List</button><button class="tab" data-tab="graph">Graph</button></div>');
      const $body = $('<div class="flowBody"></div>');
      const $list = $('<ul class="flowList"></ul>');
      const $graph = $('<div class="flowGraph"><svg/></div>').hide();
      $panel.append($title).append($tabs).append($body.append($list).append($graph));
      $sidebar.prepend($panel);

      // Styles for the panel
      if (!document.getElementById('flowViewGraphStyles')) {
        const style = `
          <style id="flowViewGraphStyles">
            #flow-wrapper { position: absolute; top: 0; bottom: 0; overflow:auto; }
            #flow-wrapper .flowTabs { display:flex; gap:8px; padding:6px 10px; border-bottom: 1px solid rgba(0,0,0,0.1); }
            #flow-wrapper .flowTabs .tab { background: none; color:#444; border: 1px solid rgba(0,0,0,0.15); padding: 3px 10px; border-radius: 4px; cursor: pointer; }
            .dark #flow-wrapper .flowTabs .tab { color:#bbb; border-color: rgba(255,255,255,0.15); }
            #flow-wrapper .flowTabs .tab.active { color: inherit; border-color:#5aa9e6; }
            #flow-wrapper .flowBody { padding: 8px 10px 12px; }
            #flow-wrapper .flowList { list-style:none; margin:0; padding:0; }
            #flow-wrapper .flowItem { padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.06); }
            .dark #flow-wrapper .flowItem { border-color: rgba(255,255,255,0.06); }
            #flow-wrapper .flowItem .type { display:inline-block; min-width: 56px; font-size: 11px; opacity: 0.7; text-transform:uppercase; }
            #flow-wrapper .flowItem a { color:#2a72b5; text-decoration:none; }
            .dark #flow-wrapper .flowItem a { color:#8fd3ff; }
            #flow-wrapper .flowItem a:hover { text-decoration:underline; }
            #flow-wrapper .flowItem .file { float:right; opacity:0.7; font-size:11px; }
            #flow-wrapper .flowGraph { width:100%; height: calc(100% - 110px); overflow:auto; }
            #flow-wrapper .flowGraph svg { width: 1000px; height: 100%; min-height: 600px; }
            #flow-wrapper .flowGraph .lane { fill: rgba(0,0,0,0.04); }
            .dark #flow-wrapper .flowGraph .lane { fill: rgba(255,255,255,0.03); }
            #flow-wrapper .flowGraph .node { fill: #333; stroke: #5aa9e6; stroke-width: 1; }
            .dark #flow-wrapper .flowGraph .node { fill: #333; }
            #flow-wrapper .flowGraph .node.unresolved { stroke: #e65a5a; }
            #flow-wrapper .flowGraph .label { fill: #fff; font-size: 12px; pointer-events: none; }
            #flow-wrapper .flowGraph .edge { stroke: #888; stroke-width: 1; fill: none; }
          </style>`;
        $('head').append(style);
      }

      // Tabs toggle
      $tabs.on('click', '.tab', (e) => {
        const tab = $(e.currentTarget).data('tab');
        $tabs.find('.tab').removeClass('active');
        $(e.currentTarget).addClass('active');
        if (tab === 'graph') {
          $list.hide();
          $graph.show();
          renderGraph($graph.find('svg'));
        } else {
          $graph.hide();
          $list.show();
        }
      });
    }

    // Populate list
    const items = collectSymbols();
    const $list = $panel.find('.flowList');
    $list.empty();
    items.forEach(it => {
      const fileLabel = it.file ? it.file.relativePath() : '';
      const $li = $(`<li class=\"flowItem ${it.type.toLowerCase()}\"><span class=\"type\">${it.type}</span> <a href=\"#\">${it.name}</a> <span class=\"file\">${fileLabel}</span></li>`);
      $li.find('a').on('click', (e) => {
        e.preventDefault();
        if (it.file) {
          InkProject.currentProject.showInkFile(it.file);
          EditorView.gotoLine(it.row + 1);
        }
      });
      $list.append($li);
    });

    // Toggle the panel using NavView so it resizes and pushes the editor
    NavView.toggle('#flow-wrapper');
  }
};
