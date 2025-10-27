const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const InkProject = require('./inkProject.js').InkProject;
const EditorView = require('./editorView.js').EditorView;
const NavView = require('./navView.js').NavView;

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
  const $graph = $('<div class="flowGraph"><svg/></div>').hide();
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
        #flow-wrapper .flowGraph .lane { fill: rgba(0,0,0,0.04); }
        .dark #flow-wrapper .flowGraph .lane { fill: rgba(255,255,255,0.03); }
        #flow-wrapper .flowGraph .node { fill:#333; stroke:#5aa9e6; stroke-width:1; }
        #flow-wrapper .flowGraph .node.unresolved { stroke:#e65a5a; }
        #flow-wrapper .flowGraph .label { fill:#fff; font-size:11px; pointer-events:none; }
        #flow-wrapper .flowGraph .edge { stroke:#888; stroke-width:1; fill:none; }
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

  // resize observer to refit graph
  const ro = new ResizeObserver(() => {
    if (!$graph.is(':visible')) return;
    renderGraph($graph.find('svg'));
  });
  ro.observe($graph[0]);

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

function collectBeats() {
  const project = InkProject.currentProject;
  if (!project) return [];
  const beats = [];
  const files = project.files || [];
  const TokenIterator = ace.require('ace/token_iterator').TokenIterator;

  function push(type, name, file, row) {
    beats.push({ type, name, file, row });
  }

  files.forEach(f => {
    try {
      const session = f.getAceSession();
      const it = new TokenIterator(session, 0, 0);
      if (it.getCurrentToken() === undefined) it.stepForward();
      const flowTypes = [
        { name: 'knot', code: '.knot.declaration', level: 1 },
        { name: 'stitch', code: '.stitch.declaration', level: 2 }
      ];
      let lastFlow = null;
      for (let tok = it.getCurrentToken(); tok; tok = it.stepForward()) {
        if (tok.type && tok.type.indexOf('.name') !== -1) {
          const t = flowTypes.find(ft => tok.type.indexOf(ft.code) !== -1);
          if (t) {
            push(t.name, tok.value, f, it.getCurrentTokenRow());
            lastFlow = tok.value;
          }
        } else if (tok.type === 'divert.target' && tok.value) {
          // a divert beat (optional label uses source→target)
          push('divert', `${lastFlow || ''}→${tok.value.trim()}`, f, it.getCurrentTokenRow());
        }
      }
    } catch (_) {}
  });

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
    const $li = $(`<li class="flowRow"><div class="flowItem"><span class="type">${b.type}</span> <a href="#" title="${fileLabel}">${b.name || '(untitled)'} </a></div></li>`);
    $li.find('a').on('click', (e) => {
      e.preventDefault();
      if (b.file) { InkProject.currentProject.showInkFile(b.file); EditorView.gotoLine((b.row||0)+1); }
    });
    $list.append($li);
  });
}

function computeGraph() {
  const project = InkProject.currentProject;
  if (!project) return { nodes: [], edges: [] };
  const TokenIterator = ace.require('ace/token_iterator').TokenIterator;
  const nodesById = new Map();
  const nodesByName = new Map();
  const edges = [];
  const edgeSet = new Set();
  const SINK_TARGETS = new Set(['DONE','END']);
  const makeId = (file, name) => `${file ? file.relativePath() : '?'}::${name}`;
  const ensure = (file, name, type, row) => {
    const id = makeId(file, name);
    if (!nodesById.has(id)) nodesById.set(id, { id, name, type, file, row: row||0 });
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
      const top = () => (stack.length ? stack[stack.length-1] : null);
      for (let tok = it.getCurrentToken(); tok; tok = it.stepForward()) {
        if (tok.type && tok.type.indexOf('.name') !== -1) {
          const t = flowTypes.find(ft => tok.type.indexOf(ft.code) !== -1);
          if (t) {
            while (top() && t.level <= top().level) stack.pop();
            const sym = { level:t.level, type:t.name, name:tok.value, row:it.getCurrentTokenRow(), file:f };
            stack.push(sym);
            ensure(f, sym.name, sym.type, sym.row);
            continue;
          }
        }
        if (tok.type === 'divert.target' && tok.value) {
          const src = top();
          if (src) {
            const target = tok.value.trim();
            if (SINK_TARGETS.has(target)) continue;
            const from = ensure(src.file, src.name, src.type, src.row);
            const key = `${from.id}->${target}`;
            if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ from: from.id, toName: target }); }
          }
        }
      }
    } catch(_){}
  });

  // Secondary robust pass: regex scan for '-> target' and use symbols.flowAtPos to find source
  (project.files || []).forEach(f => {
    try {
      if (!f || !f.symbols || !f.getAceSession) return;
      const session = f.getAceSession();
      const lineCount = session.getLength();
      const re = /\-\>\s*([A-Za-z0-9_\.]+)/g;
      for (let row = 0; row < lineCount; row++) {
        const text = session.getLine(row);
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const target = m[1];
          if (SINK_TARGETS.has(target)) continue;
          // Identify the owning flow at this row
          let owner = null;
          try {
            const syms = f.symbols.flowAtPos({ row, column: 0 });
            if (syms) {
              if (syms.Stitch) owner = syms.Stitch;
              else if (syms.Knot) owner = syms.Knot;
            }
          } catch(_) {}
          if (owner) {
            const from = ensure(owner.inkFile, owner.name, owner.flowType.name, owner.row);
            const key = `${from.id}->${target}`;
            if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ from: from.id, toName: target }); }
          }
        }
      }
    } catch(_){}
  });
  edges.forEach(e => {
    if (SINK_TARGETS.has(e.toName)) { e.to = null; return; }
    const dest = nodesByName.get(e.toName);
    e.to = dest ? dest.id : ensure(null, e.toName, 'Unresolved', 0).id;
  });
  // Drop any edges with no resolved destination (e.g. DONE/END sinks)
  for (let i = edges.length - 1; i >= 0; i--) { if (!edges[i].to) edges.splice(i,1); }
  const nodes = Array.from(nodesById.values());
  nodes.sort((a,b)=>{ const fa=a.file? a.file.relativePath():'~'; const fb=b.file? b.file.relativePath():'~'; if(fa!==fb) return fa.localeCompare(fb); return a.row-b.row; });
  return { nodes, edges };
}

function renderGraph($svg) {
  const data = computeGraph();
  const svg = $svg[0];
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const nodeW = 140, nodeH = 22, vGap = 14;
  const baseX = 10, laneSpacing = Math.max(160, Math.floor(($svg.parent().width()||800)/5));

  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const incoming = new Map(), outgoing = new Map();
  data.nodes.forEach(n => { incoming.set(n.id, []); outgoing.set(n.id, []); });
  data.edges.forEach(e => { if(incoming.has(e.to)) incoming.get(e.to).push(e.from); if(outgoing.has(e.from)) outgoing.get(e.from).push(e.to); });

  const laneOf = new Map();
  const preferredLane = new Map();
  let maxLane = -1;
  data.nodes.forEach((n, idx) => {
    n.y = 16 + idx * (nodeH + vGap);
    const preds = (incoming.get(n.id)||[]).map(id=>laneOf.get(id)).filter(v=>v!==undefined);
    let lane = preferredLane.has(n.id) ? preferredLane.get(n.id)
      : preds.length===1 ? preds[0]
      : preds.length>1 ? Math.min.apply(null, preds)
      : 0;
    if (lane===undefined || lane<0) lane = 0;
    laneOf.set(n.id, lane);
    if (lane>maxLane) maxLane = lane;
    const outs = outgoing.get(n.id)||[];
    outs.forEach((toId,i)=>{
      if (!preferredLane.has(toId)) {
        const targetLane = i===0 ? lane : (maxLane + 1 + (i-1));
        preferredLane.set(toId, targetLane);
        if (targetLane>maxLane) maxLane = targetLane;
      }
    });
  });

  // Create a viewport group to allow scaling
  const viewport = document.createElementNS('http://www.w3.org/2000/svg','g');
  viewport.setAttribute('id','viewport');
  svg.appendChild(viewport);

  // lanes backgrounds
  for(let li=0; li<=maxLane; li++){
    const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x', `${baseX + li*laneSpacing - 8}`);
    r.setAttribute('y', `0`);
    r.setAttribute('width', `${laneSpacing}`);
    r.setAttribute('height', `100%`);
    r.setAttribute('class','lane');
    viewport.appendChild(r);
  }

  data.nodes.forEach(n => { n.x = baseX + (laneOf.get(n.id)||0)*laneSpacing; });

  // edges
  data.edges.forEach(e => {
    const a = byId.get(e.from), b = byId.get(e.to); if(!a||!b) return;
    const x1 = a.x + nodeW, y1 = a.y + nodeH/2; const x2 = b.x, y2 = b.y + nodeH/2;
    const midX = (x1+x2)/2;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','edge');
    path.setAttribute('d', `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
    viewport.appendChild(path);
  });

  // nodes
  data.nodes.forEach(n => {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.style.cursor = 'pointer';
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('rx','4'); rect.setAttribute('ry','4'); rect.setAttribute('width',`${nodeW}`); rect.setAttribute('height',`${nodeH}`);
    rect.setAttribute('class', `node ${n.type==='Unresolved' ? 'unresolved' : ''}`);
    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x','6'); text.setAttribute('y',`${nodeH/2+4}`); text.setAttribute('class','label'); text.textContent = n.name;
    g.appendChild(rect); g.appendChild(text); viewport.appendChild(g);
    g.addEventListener('click',()=>{ if(n.file){ try{ InkProject.currentProject.showInkFile(n.file); EditorView.gotoLine((n.row||0)+1);}catch(_){}} });
  });

  // Compute content bounds for scrollbars
  let maxLaneIndex = maxLane;
  let maxY = 0;
  data.nodes.forEach(n => { if (n.y + nodeH > maxY) maxY = n.y + nodeH; });
  const contentWidth = baseX + (maxLaneIndex * laneSpacing) + nodeW + 20;
  const contentHeight = maxY + 20;

  // Use viewBox for logical coords; size svg element to scaled content so scrollbars appear
  svg.setAttribute('viewBox', `0 0 ${contentWidth} ${contentHeight}`);
  const scale = getZoomScale();
  // Use only viewBox->viewport scaling (via width/height) for zoom; avoid double-scaling group
  viewport.setAttribute('transform', `scale(1)`);
  const w = Math.max(1, Math.round(contentWidth * scale));
  const h = Math.max(1, Math.round(contentHeight * scale));
  // Set both attributes and style to ensure layout engines compute scrollHeight/Width
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';
}

// Simple module-scoped zoom state/helpers
let __flowZoomScale = 1;
function setZoomScale(v){ __flowZoomScale = Math.max(0.5, Math.min(3, v)); }
function getZoomScale(){ return __flowZoomScale; }

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
  toggle: function(buttonId){
    const $panel = ensurePanel();
    // Refresh immediately when toggled open/closed
    this.refreshNow();
    NavView.toggle('#flow-wrapper', buttonId);
    // If graph is the active tab, ensure a reasonable width
    const $graph = $('#flow-wrapper .flowGraph');
    if ($graph.is(':visible')) {
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
