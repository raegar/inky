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
        #flow-wrapper { position:absolute; top:0; bottom:0; overflow:auto; }
        #flow-wrapper .flowControls { padding: 6px 10px; }
        #flow-wrapper .flowControls .flowFilter { width: 100%; box-sizing: border-box; padding: 4px 8px; }
        #flow-wrapper .flowHeader { display:flex; padding: 6px 10px; border-bottom: 1px solid rgba(0,0,0,0.1); }
        #flow-wrapper .flowTabs { display:flex; gap:8px; }
        #flow-wrapper .flowTabs .tab { background:none; border:1px solid rgba(0,0,0,0.15); padding:3px 10px; border-radius:4px; cursor:pointer; color:#444; }
        .dark #flow-wrapper .flowTabs .tab { color:#bbb; border-color: rgba(255,255,255,0.15); }
        #flow-wrapper .flowTabs .tab.active { border-color:#5aa9e6; }
        #flow-wrapper .flowBody { display:flex; gap:8px; padding: 8px 10px 12px; }
        #flow-wrapper .flowLabels { flex: 0 0 180px; overflow:auto; }
        #flow-wrapper .flowGraph { flex: 1 1 auto; overflow:auto; }
        #flow-wrapper .flowList { list-style:none; margin:0; padding:0; }
        #flow-wrapper .flowList .flowRow { display:flex; align-items:center; height:24px; }
        #flow-wrapper .flowItem { width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-bottom:1px solid rgba(0,0,0,0.06); padding:3px 2px; font-size:12px; }
        .dark #flow-wrapper .flowItem { border-color: rgba(255,255,255,0.06); }
        #flow-wrapper .flowItem .type { opacity:0.6; margin-right:6px; text-transform:uppercase; font-size:10px; }
        #flow-wrapper .flowItem a { color:#2a72b5; text-decoration:none; }
        .dark #flow-wrapper .flowItem a { color:#8fd3ff; }
        #flow-wrapper .flowItem a:hover { text-decoration:underline; }
        /* Graph */
        #flow-wrapper .flowGraph svg { width:100%; height: calc(100% - 8px); min-height: 400px; }
        #flow-wrapper .flowGraph .lane { fill: rgba(0,0,0,0.04); }
        .dark #flow-wrapper .flowGraph .lane { fill: rgba(255,255,255,0.03); }
        #flow-wrapper .flowGraph .node { fill:#333; stroke:#5aa9e6; stroke-width:1; }
        #flow-wrapper .flowGraph .node.unresolved { stroke:#e65a5a; }
        #flow-wrapper .flowGraph .label { fill:#fff; font-size:11px; pointer-events:none; }
        #flow-wrapper .flowGraph .edge { stroke:#888; stroke-width:1; fill:none; }
      </style>`;
    $('head').append(style);
  }

  // tab logic
  $tabs.on('click', '.tab', (e) => {
    const tab = $(e.currentTarget).data('tab');
    $tabs.find('.tab').removeClass('active');
    $(e.currentTarget).addClass('active');
    if (tab === 'graph') {
      $labels.hide();
      $graph.show();
      renderGraph($graph.find('svg'));
    } else {
      $graph.hide();
      $labels.show();
    }
  });

  // resize observer to refit graph
  const ro = new ResizeObserver(() => {
    if (!$graph.is(':visible')) return;
    renderGraph($graph.find('svg'));
  });
  ro.observe($graph[0]);

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
    const $li = $(`<li class="flowRow"><div class="flowItem"><span class="type">${b.type}</span> <a href="#">${b.name || '(untitled)'} </a><span class="file">${fileLabel}</span></div></li>`);
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
          if (src) { const from = ensure(src.file, src.name, src.type, src.row); edges.push({ from: from.id, toName: tok.value.trim() }); }
        }
      }
    } catch(_){}
  });
  edges.forEach(e => { const dest = nodesByName.get(e.toName); e.to = dest ? dest.id : ensure(null, e.toName, 'Unresolved', 0).id; });
  const nodes = Array.from(nodesById.values());
  nodes.sort((a,b)=>{ const fa=a.file? a.file.relativePath():'~'; const fb=b.file? b.file.relativePath():'~'; if(fa!==fb) return fa.localeCompare(fb); return a.row-b.row; });
  return { nodes, edges };
}

function renderGraph($svg) {
  const data = computeGraph();
  const svg = $svg[0];
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const nodeW = 140, nodeH = 22, vGap = 14;
  const baseX = 10, laneSpacing = Math.max(160, Math.floor($svg.width()/5));

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

  // lanes backgrounds
  for(let li=0; li<=maxLane; li++){
    const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x', `${baseX + li*laneSpacing - 8}`);
    r.setAttribute('y', `0`);
    r.setAttribute('width', `${laneSpacing}`);
    r.setAttribute('height', `100%`);
    r.setAttribute('class','lane');
    svg.appendChild(r);
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
    svg.appendChild(path);
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
    g.appendChild(rect); g.appendChild(text); svg.appendChild(g);
    g.addEventListener('click',()=>{ if(n.file){ try{ InkProject.currentProject.showInkFile(n.file); EditorView.gotoLine((n.row||0)+1);}catch(_){}} });
  });
}

exports.FlowView = {
  toggle: function(){
    const $panel = ensurePanel();
    populateList($panel);
    NavView.toggle('#flow-wrapper');
  }
};
