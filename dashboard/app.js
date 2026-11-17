// Token Launch Radar dashboard: renders window.RADAR (written by main.ts as
// ../data.js). No network, no framework. Supports ?detail=<slug>, ?chain=<name>,
// ?watch=1 and ?q=<text> so each view is linkable and screenshot-able.
(function () {
  const D = window.RADAR;
  if (!D) return;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
  const pct = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const maxImplied = Math.max(...D.rows.map((r) => r.implied_value_usd));

  $('modelVersion').textContent = D.model_version;
  $('asOf').textContent = D.as_of;
  $('modelNote').innerHTML =
    '<b>How to read this board:</b> implied value anchors each category to the median market-cap/TVL the market pays live-token peers, ' +
    'then adjusts for 7-day momentum, age and chain breadth. ★ marks the 40-protocol watchlist (TVL ≥ ' + fmt(D.floor_usd) + ', records no token). ' +
    'Rows below the floor are the early radar. Click any row for its farm plan.';
  $('stats').innerHTML = [
    [D.board_size, 'ranked protocols'],
    [D.watchlist_size + ' / ' + D.board_size, 'watchlist covered'],
    [fmt(D.total_implied_usd), 'total implied value'],
    [D.early_size, 'early (below floor)'],
    [pct(D.median_change_7d), 'median 7d TVL change'],
    [D.top_mover ? esc(D.top_mover) + ' ' + pct(D.top_mover_change) : '—', 'top 7d mover'],
    [D.high_risk_size, 'high-risk rows'],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('liveChips').innerHTML = D.live.slice(0, 10).map((p) => `<span class="chip"><b>${esc(p.name)}</b> mcap ${fmt(p.mcap_usd)} · TVL ${fmt(p.tvl_usd)}</span>`).join('');

  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
  for (const c of chains) $('chainSel').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
  for (const c of cats) $('catSel').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);

  const params = new URLSearchParams(location.search);
  if (params.get('chain')) $('chainSel').value = params.get('chain');
  if (params.get('q')) $('q').value = params.get('q');
  if (params.get('watch') === '1') $('watchOnly').checked = true;
  if (params.get('sort')) $('sortSel').value = params.get('sort');

  let sortKey = params.get('sort') || 'rank';
  let selected = params.get('detail') || null;

  function visible() {
    const q = $('q').value.trim().toLowerCase();
    const chain = $('chainSel').value;
    const cat = $('catSel').value;
    const risk = $('riskSel').value;
    const watch = $('watchOnly').checked;
    let rows = D.rows.filter((r) =>
      (!q || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(q)) &&
      (!chain || r.chains.includes(chain)) &&
      (!cat || r.category === cat) &&
      (!risk || r.risk === risk) &&
      (!watch || r.watchlist));
    const by = {
      rank: (a, b) => a.rank - b.rank,
      implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      change: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
      efficiency: (a, b) => b.efficiency - a.efficiency,
      age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    };
    return rows.sort(by[sortKey] || by.rank);
  }

  function render() {
    const rows = visible();
    $('count').textContent = rows.length + ' shown';
    $('rows').innerHTML = rows.map((r) => `
      <tr data-slug="${esc(r.slug)}" class="${r.watchlist ? 'watch' : ''}">
        <td>${r.rank}</td>
        <td>${r.watchlist ? '<span class="star">★</span> ' : ''}<b>${esc(r.name)}</b><br><small>${esc(r.slug)}</small></td>
        <td>${esc(r.category || '—')}</td>
        <td class="num">${fmt(r.tvl_usd)}</td>
        <td class="num ${r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
        <td class="num"><b>${fmt(r.implied_value_usd)}</b><div class="bar"><i style="width:${Math.max(2, (r.implied_value_usd / maxImplied) * 100)}%"></i></div></td>
        <td class="num">${fmt(r.efficiency)}</td>
        <td class="num">${r.multiple.toFixed(2)}×</td>
        <td><span class="badge ${r.risk}">${r.risk}</span></td>
        <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>
      </tr>`).join('');
    for (const tr of document.querySelectorAll('#rows tr')) {
      tr.addEventListener('click', () => { selected = tr.dataset.slug; renderDetail(); });
    }
    renderDetail();
  }

  function renderDetail() {
    const box = $('detail');
    const r = D.rows.find((x) => x.slug === selected);
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <h2>${r.watchlist ? '★ ' : ''}${esc(r.name)}</h2>
      <div class="meta">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')} · records no token</div>
      <div class="kv">
        <div><b>${fmt(r.implied_value_usd)}</b><span>implied value (rank #${r.rank})</span></div>
        <div><b>${fmt(r.tvl_usd)}</b><span>TVL</span></div>
        <div><b>${pct(r.change_7d)}</b><span>TVL change 7d</span></div>
        <div><b>${r.age_days == null ? 'unknown' : r.age_days + ' days'}</b><span>tracked since ${esc(r.listed_at || '—')}</span></div>
        <div><b>${r.multiple.toFixed(2)}×</b><span>category peer multiple</span></div>
        <div><b>${r.momentum_multiplier.toFixed(2)}× / ${r.maturity_multiplier.toFixed(2)}×</b><span>momentum / maturity</span></div>
        <div><b>${fmt(r.capital_usd)} → ${fmt(r.efficiency)}</b><span>suggested capital → value per $</span></div>
        <div><b>${r.risk_multiplier.toFixed(2)}×</b><span>risk discount applied</span></div>
      </div>
      <p><span class="badge ${r.risk}">${r.risk} risk</span> · chains: ${esc(r.chains.join(', ') || '—')}</p>
      ${r.risk_notes.length ? `<p class="risknotes">Watch: ${r.risk_notes.map(esc).join(' · ')}</p>` : '<p class="risknotes">No risk flags from TVL trend, breadth or age.</p>'}
      <h3>Farm plan — sequenced</h3>
      <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <button id="closeDetail" type="button">Close</button>`;
    $('closeDetail').addEventListener('click', () => { selected = null; renderDetail(); });
  }

  for (const id of ['q', 'chainSel', 'catSel', 'riskSel', 'watchOnly']) $(id).addEventListener('input', render);
  $('sortSel').addEventListener('change', () => { sortKey = $('sortSel').value; render(); });
  for (const th of document.querySelectorAll('#board th[data-k]')) {
    th.addEventListener('click', () => {
      const map = { rank: 'rank', name: 'rank', category: 'rank', tvl: 'tvl', change: 'change', implied: 'implied', eff: 'efficiency', mult: 'implied' };
      sortKey = map[th.dataset.k] || 'rank';
      $('sortSel').value = sortKey;
      render();
    });
  }
  render();
  window.__shotReady = true;
})();
