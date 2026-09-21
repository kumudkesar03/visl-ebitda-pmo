'use strict';

/**
 * The VISL reporting hierarchy.
 *
 *   VISL                       consolidated
 *     +-- ESL                  leaf
 *     +-- IOB                  consolidated
 *     |     +-- IOK            leaf
 *     |     +-- IOG            leaf
 *     |     +-- VAB            leaf
 *     |     +-- HO             leaf
 *     +-- FACOR                leaf
 *
 * GOVERNING RULE (carried forward from text.txt section 5):
 *   Initiatives attach ONLY to leaf nodes. Consolidated nodes never hold rows
 *   directly. Every level is therefore the exact arithmetic sum of its
 *   descendants and no figure can be double counted.
 *
 * Adding a sub-unit later (e.g. ESL gaining plants) means adding a row here
 * and flipping ESL to consolidated. No other code changes.
 */

const UNITS = [
  { code: 'VISL',  name: 'Vedanta Iron & Steel',        shortName: 'VISL',  parent: null,   consolidated: true,  sort: 1,  accent: '#0b3d6e' },
  { code: 'ESL',   name: 'ESL Steel Limited',           shortName: 'ESL',   parent: 'VISL', consolidated: false, sort: 2,  accent: '#0062ae' },
  { code: 'IOB',   name: 'Iron Ore Business',           shortName: 'IOB',   parent: 'VISL', consolidated: true,  sort: 3,  accent: '#4d8f2a' },
  { code: 'IOK',   name: 'Iron Ore Karnataka',          shortName: 'IOK',   parent: 'IOB',  consolidated: false, sort: 4,  accent: '#1f8a7a' },
  { code: 'IOG',   name: 'Iron Ore Goa',                shortName: 'IOG',   parent: 'IOB',  consolidated: false, sort: 5,  accent: '#6a55a8' },
  { code: 'VAB',   name: 'Value Added Business',        shortName: 'VAB',   parent: 'IOB',  consolidated: false, sort: 6,  accent: '#b7791f' },
  { code: 'HO',    name: 'IOB Head Office',             shortName: 'HO',    parent: 'IOB',  consolidated: false, sort: 7,  accent: '#6b7178' },
  { code: 'FACOR', name: 'Ferro Alloys Corporation',    shortName: 'FACOR', parent: 'VISL', consolidated: false, sort: 8,  accent: '#b4452f' },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]));

/** Depth from VISL (VISL = 0). */
function depthOf(code) {
  let d = 0;
  let cur = BY_CODE.get(code);
  while (cur && cur.parent) { d += 1; cur = BY_CODE.get(cur.parent); }
  return d;
}

const ALL = UNITS.map((u) => ({ ...u, depth: depthOf(u.code) }));

function get(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || null;
}
function exists(code) { return BY_CODE.has(String(code || '').toUpperCase()); }

function childrenOf(code) {
  return ALL.filter((u) => u.parent === code).sort((a, b) => a.sort - b.sort);
}

/**
 * The node itself plus every descendant. This is the in-process equivalent of
 * the vw_bu_descendants recursive CTE, and the two must always agree —
 * sql/02_views_rollup.sql carries the SQL side.
 */
function descendantsOf(code) {
  const root = get(code);
  if (!root) return [];
  const out = [];
  const walk = (c) => { out.push(c); childrenOf(c).forEach((k) => walk(k.code)); };
  walk(root.code);
  return out;
}

/** Leaf nodes under a code — the only nodes that can carry initiatives. */
function leavesOf(code) {
  return descendantsOf(code).filter((c) => !get(c).consolidated);
}

const LEAF_CODES = ALL.filter((u) => !u.consolidated).map((u) => u.code);

/** Ancestor chain from VISL down to the node, inclusive. Used for breadcrumbs. */
function pathOf(code) {
  const chain = [];
  let cur = get(code);
  while (cur) { chain.unshift(cur); cur = cur.parent ? get(cur.parent) : null; }
  return chain;
}

function isDescendantOf(code, ancestorCode) {
  return descendantsOf(ancestorCode).includes(String(code || '').toUpperCase());
}

/** Ordered for display: parents immediately followed by their children. */
function displayOrder() {
  const out = [];
  const walk = (code) => { out.push(get(code)); childrenOf(code).forEach((c) => walk(c.code)); };
  walk('VISL');
  return out;
}

module.exports = {
  ALL, LEAF_CODES, ROOT: 'VISL',
  get, exists, childrenOf, descendantsOf, leavesOf, pathOf, isDescendantOf, displayOrder,
};
