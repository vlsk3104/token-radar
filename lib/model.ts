// Token Launch Radar model, pass 1.
//
// Point of view: a pre-token protocol's launch value is anchored to what the
// market already pays for live-token peers. For each category we compute the
// median market-cap / TVL ratio of token-bearing protocols in the snapshot,
// clamp it to a sane band, and use it as that category's multiple. A protocol
// with no live peers in its category falls back to the global median ratio.
// The anchor is then adjusted by 7-day TVL momentum, by maturity (age since
// DefiLlama first tracked it), and by chain breadth. Protocols that already
// record a token never enter the ranked board; they are reported separately
// as the live peer set that calibrates the model.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'anchor-2';
export const BOARD_ROWS = 220;
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A wrapped, staked or bridged product of a token that already trades is not a launch candidate. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED.test(p.name);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Category multiples derived from live peers: median mcap/TVL, clamped. */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    all.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
  }
  const global = clamp(median(all), 0.05, 1.5);
  const byCategory = new Map<string, number>();
  for (const [key, list] of ratios) {
    if (list.length >= 3) byCategory.set(key, clamp(median(list), 0.05, 2.0));
  }
  return { byCategory, global };
}

export interface Scored {
  implied: number;
  multiple: number;
  momentumMult: number;
  maturityMult: number;
  breadthMult: number;
  riskMult: number;
  capital: number;
  efficiency: number;
  age: number | null;
  risk: 'low' | 'medium' | 'high';
  riskNotes: string[];
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, number>; global: number },
): Scored {
  const multiple = multiples.byCategory.get(p.category ?? 'Uncategorised') ?? multiples.global;
  const growth = clamp(p.change_7d ?? 0, -60, 120);
  const momentumMult = 1 + (growth / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  const maturityMult = 0.7 + (clamp(ageForModel, 0, 1095) / 1095) * 0.3;
  const breadthMult = p.chains.length >= 4 ? 1.1 : p.chains.length >= 2 ? 1.04 : 1.0;
  // Risk is priced, not just labelled: steep TVL decline, single-chain
  // concentration and a very short track record each discount the anchor.
  const riskNotes: string[] = [];
  let riskMult = 1;
  if ((p.change_7d ?? 0) <= -15) { riskNotes.push('TVL fell more than 15% in 7 days'); riskMult *= 0.88; }
  else if ((p.change_7d ?? 0) <= -5) { riskNotes.push('TVL falling this week'); riskMult *= 0.96; }
  if (p.chains.length <= 1) { riskNotes.push('Single-chain concentration'); riskMult *= 0.95; }
  if (age !== null && age < 90) { riskNotes.push('Tracked for under 90 days'); riskMult *= 0.95; }
  if (p.change_7d === null) riskNotes.push('No 7-day TVL change reported');
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentumMult * maturityMult * breadthMult * riskMult));
  const risk: Scored['risk'] = riskNotes.length >= 2 ? 'high' : riskNotes.length === 1 ? 'medium' : 'low';
  const capital = capitalFor(p);
  // Efficiency: implied launch value per dollar of suggested farm capital.
  // Small-capital farmers should rank by this, not by raw implied value.
  const efficiency = Math.round(implied / capital);
  return { implied, multiple: round4(multiple), momentumMult: round4(momentumMult), maturityMult: round4(maturityMult), breadthMult, riskMult: round4(riskMult), capital, efficiency, age, risk, riskNotes };
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  risk: string;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  multiple: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  risk_multiplier: number;
  risk_notes: string[];
  capital_usd: number;
  efficiency: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_change_7d: number | null;
  top_mover: string | null;
  top_mover_change: number | null;
  high_risk_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow no more than 30% against it so the position survives volatility`;
  if (c.includes('dex')) return `Provide $${capital} split evenly between USDC and the pool's paired asset in ${n}'s highest-TVL pool on ${chain}`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then deploy the bridged funds in one destination app the same day`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} worth of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet`;
  if (c.includes('perpetual') || c.includes('deriv')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged trade, closing and reopening it weekly`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into the largest ${n} vault on ${chain} and keep the vault shares untouched while they accrue`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open`;
}

/** Six sequenced steps: setup, core action, cadence, cross-chain breadth, hold + claim, exit rule. */
export function farmSteps(p: SnapshotProtocol, age: number | null, change7d: number | null): string[] {
  const chain = chainOf(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const move = change7d === null ? 'unreported this week' : `${change7d > 0 ? 'up' : 'down'} ${Math.abs(change7d).toFixed(1)}% in 7 days`;
  const steps = [
    `Set up a fresh wallet for ${p.name} only, fund it with $${capital + 20} on ${chain}, and store the seed phrase offline. Cost: under $3 in gas. Time: 10 minutes.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus about $${gas} in gas. Time: 15 minutes to set up.`,
    `Repeat one qualifying action every week (deposit, swap, borrow or vote inside ${p.name}) so activity spans several snapshots; TVL is ${move}, so re-check size monthly. Cost: about $2 in gas per week. Time: 10 minutes a week.`,
    secondChain !== null
      ? `From week 2, mirror a quarter of the position on ${secondChain}, ${p.name}'s second chain, so activity is not single-chain if distribution weights breadth. Cost: about $6 in bridge and gas fees. Time: 25 minutes once.`
      : `Deepen the single-chain position instead: add a second, different action type inside ${p.name} on ${chain} (for example borrow after supplying) so the wallet shows varied use. Cost: about $3 in gas. Time: 15 minutes once.`,
    `Hold the position for at least ${hold} days, then check ${p.name}'s official points or rewards page and claim only from links it publishes. Cost: no fee to check; never pay to claim. Time: ${hold} days holding, 10 minutes to check.`,
    `Exit rule: if ${p.name}'s TVL drops 25% from your entry week or a token launches with a snapshot already taken, withdraw within 7 days and log the result. Cost: about $${gas} in gas to unwind. Time: 20 minutes.`,
  ];
  if (change7d !== null && change7d <= -15) {
    steps[1] = `Start at half size while TVL is falling: ${actionFor(p, Math.round(capital / 2), chain)}. Cost: $${Math.round(capital / 2)} of capital plus about $${gas} in gas. Time: 15 minutes to set up.`;
  }
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radarRows: RadarRow[] } {
  const multiples = categoryMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scoredAll = snapshot.protocols
    .filter((p) => isRankable(p) && !chosen.has(p.slug))
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, multiples) }))
    .sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  for (const { p } of scoredAll.slice(0, Math.max(0, BOARD_ROWS - chosen.size))) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, multiples) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = [];
  const radarRows: RadarRow[] = [];
  scored.forEach(({ p, s }, i) => {
    const steps = farmSteps(p, s.age, p.change_7d);
    const base: BoardRow = {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: s.age,
      implied_value_usd: s.implied,
      watchlist: watch.has(p.slug),
      risk: s.risk,
      farm_steps: steps,
    };
    board.push(base);
    radarRows.push({ ...base, multiple: s.multiple, momentum_multiplier: s.momentumMult, maturity_multiplier: s.maturityMult, risk_multiplier: s.riskMult, risk_notes: s.riskNotes, capital_usd: s.capital, efficiency: s.efficiency });
  });
  return { board, radarRows };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, radarRows } = buildBoard(snapshot);
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
  const changes = board.map((r) => r.change_7d).filter((v): v is number => v !== null);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    median_change_7d: changes.length > 0 ? Math.round(median(changes) * 100) / 100 : null,
    top_mover: board.reduce<BoardRow | null>((best, r) => (r.change_7d !== null && (best === null || r.change_7d > (best.change_7d ?? -Infinity)) ? r : best), null)?.name ?? null,
    top_mover_change: board.reduce<number | null>((best, r) => (r.change_7d !== null && (best === null || r.change_7d > best) ? r.change_7d : best), null),
    high_risk_size: board.filter((r) => r.risk === 'high').length,
    rows: radarRows,
    live,
  };
  return { board, radar };
}

export class SnapshotError extends Error {}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.source !== 'string' || typeof o.floor_usd !== 'number') throw new SnapshotError('snapshot.json misses header fields');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('snapshot.json misses protocols or watchlist');
  const protocols = (o.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: typeof p.tvl_usd === 'number' ? p.tvl_usd : 0,
    change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: (o.watchlist as unknown[]).map(String) };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing watchlist: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank mismatch at ${i}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied value rises at rank ${i + 1}`;
    for (const s of board[i]!.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${board[i]!.slug} has a bad farm step`;
    if (board[i]!.farm_steps.length < 3 || board[i]!.farm_steps.length > 12) return `${board[i]!.slug} step count`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
