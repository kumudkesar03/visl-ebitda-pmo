'use strict';

/**
 * The synthetic portfolio catalogue.
 *
 * *** EVERY FIGURE IN THIS FILE IS ILLUSTRATIVE. ***
 * *** IT IS NOT REPORTED BUSINESS RESULT. ***
 *
 * Initiative titles are drawn from the levers these businesses genuinely pull
 * so the screens read correctly in a review, but the money is invented. Each
 * generated row is tagged [SYNTHETIC] in its description, which is the same
 * marker sql/99_reset_synthetic.sql matches on when clearing the database
 * before real figures are loaded.
 *
 * Targets are stated per initiative and roll up exactly:
 *
 *      ESL    34.00        IOK    21.00
 *      IOG    13.50        VAB    14.20
 *      HO      9.30        FACOR  19.40
 *      -------------------------------------
 *      IOB    58.00   (IOK + IOG + VAB + HO)
 *      VISL  111.40   (ESL + IOB + FACOR)
 */

/** EBITDA levers. The category axis on every executive chart. */
const CATEGORIES = [
  { code: 'RAW', name: 'Raw material & sourcing', accent: '#0062ae' },
  { code: 'ENE', name: 'Energy & fuel', accent: '#d08a1c' },
  { code: 'LOG', name: 'Logistics & freight', accent: '#4d8f2a' },
  { code: 'YLD', name: 'Yield & recovery', accent: '#6a55a8' },
  { code: 'CON', name: 'Contracts & manpower', accent: '#1f8a7a' },
  { code: 'SPR', name: 'Stores & spares', accent: '#b4452f' },
  { code: 'WCP', name: 'Working capital', accent: '#8a9a1e' },
  { code: 'SLS', name: 'Sales realisation', accent: '#b0487a' },
  { code: 'OVH', name: 'Overheads & admin', accent: '#5f6b76' },
  { code: 'DIG', name: 'Digital & automation', accent: '#2c4f9e' },
];

/**
 * Departments are BU-qualified. text.txt section 4 records the unique-key
 * collision that forced this: departments.name carries a UNIQUE constraint and
 * IOB's "Commercial" collided with ESL's, aborting the whole load. Beyond the
 * constraint it is simply correct - with one shared table across six units,
 * "Finance" alone is ambiguous.
 */
const DEPARTMENTS = [
  { code: 'ESL-OPS', name: 'Operations (ESL)', bu: 'ESL' },
  { code: 'ESL-COM', name: 'Commercial (ESL)', bu: 'ESL' },
  { code: 'ESL-MNT', name: 'Maintenance (ESL)', bu: 'ESL' },
  { code: 'ESL-SCM', name: 'Supply chain (ESL)', bu: 'ESL' },
  { code: 'IOK-OPS', name: 'Operations (IOK)', bu: 'IOK' },
  { code: 'IOK-COM', name: 'Commercial (IOK)', bu: 'IOK' },
  { code: 'IOK-LOG', name: 'Logistics (IOK)', bu: 'IOK' },
  { code: 'IOG-OPS', name: 'Operations (IOG)', bu: 'IOG' },
  { code: 'IOG-COM', name: 'Commercial (IOG)', bu: 'IOG' },
  { code: 'IOG-LOG', name: 'Logistics (IOG)', bu: 'IOG' },
  { code: 'VAB-OPS', name: 'Operations (VAB)', bu: 'VAB' },
  { code: 'VAB-COM', name: 'Commercial (VAB)', bu: 'VAB' },
  { code: 'HO-FIN', name: 'Finance (HO)', bu: 'HO' },
  { code: 'HO-ADM', name: 'Administration (HO)', bu: 'HO' },
  { code: 'FAC-OPS', name: 'Operations (FACOR)', bu: 'FACOR' },
  { code: 'FAC-COM', name: 'Commercial (FACOR)', bu: 'FACOR' },
  { code: 'FAC-FIN', name: 'Finance (FACOR)', bu: 'FACOR' },
];

/**
 * People. Synthetic accounts covering every role in the matrix so access
 * control can be demonstrated by signing in rather than described in a slide.
 */
const USERS = [
  { employee_id: 'kumud.kesar',   name: 'Kumud Kesar',      role: 'admin',      home_bu: 'VISL',  designation: 'Lead - Digital' },
  { employee_id: 'visl.ceo',      name: 'A. Raghavan',      role: 'visl_exec',  home_bu: 'VISL',  designation: 'Chief Executive Officer, VISL' },
  { employee_id: 'visl.cfo',      name: 'M. Sundaram',      role: 'visl_exec',  home_bu: 'VISL',  designation: 'Chief Financial Officer, VISL' },
  { employee_id: 'iob.head',      name: 'R. Deshmukh',      role: 'visl_exec',  home_bu: 'VISL',  designation: 'Business Head - Iron Ore' },
  { employee_id: 'visl.pmo1',     name: 'S. Venkatesh',     role: 'visl_pmo',   home_bu: 'VISL',  designation: 'Head - VISL Programme Office' },
  { employee_id: 'visl.pmo2',     name: 'N. Bhattacharya',  role: 'visl_pmo',   home_bu: 'VISL',  designation: 'Manager - Programme Office' },

  { employee_id: 'esl.pmo',       name: 'R. Banerjee',      role: 'bu_pmo',     home_bu: 'ESL',   designation: 'PMO Lead - ESL' },
  { employee_id: 'iob.pmo',       name: 'P. Krishnan',      role: 'bu_pmo',     home_bu: 'IOB',   designation: 'PMO Lead - Iron Ore Business' },
  { employee_id: 'iok.pmo',       name: 'V. Shetty',        role: 'bu_pmo',     home_bu: 'IOK',   designation: 'PMO Lead - IOK' },
  { employee_id: 'iog.pmo',       name: 'D. Naik',          role: 'bu_pmo',     home_bu: 'IOG',   designation: 'PMO Lead - IOG' },
  { employee_id: 'vab.pmo',       name: 'H. Mohanty',       role: 'bu_pmo',     home_bu: 'VAB',   designation: 'PMO Lead - VAB' },
  { employee_id: 'ho.pmo',        name: 'J. Iyer',          role: 'bu_pmo',     home_bu: 'HO',    designation: 'PMO Lead - IOB Head Office' },
  { employee_id: 'facor.pmo',     name: 'B. Sahoo',         role: 'bu_pmo',     home_bu: 'FACOR', designation: 'PMO Lead - FACOR' },

  { employee_id: 'esl.own1',      name: 'T. Chatterjee',    role: 'owner',      home_bu: 'ESL',   designation: 'Head - Blast Furnace' },
  { employee_id: 'esl.own2',      name: 'G. Ramesh',        role: 'owner',      home_bu: 'ESL',   designation: 'Head - Steel Melting Shop' },
  { employee_id: 'esl.own3',      name: 'K. Sinha',         role: 'owner',      home_bu: 'ESL',   designation: 'Head - Supply Chain' },
  { employee_id: 'iok.own1',      name: 'L. Gowda',         role: 'owner',      home_bu: 'IOK',   designation: 'Head - Mines Operations' },
  { employee_id: 'iok.own2',      name: 'C. Prabhu',        role: 'owner',      home_bu: 'IOK',   designation: 'Head - Beneficiation' },
  { employee_id: 'iog.own1',      name: 'F. D Souza',       role: 'owner',      home_bu: 'IOG',   designation: 'Head - Goa Operations' },
  { employee_id: 'vab.own1',      name: 'A. Patnaik',       role: 'owner',      home_bu: 'VAB',   designation: 'Head - Pellet Plant' },
  { employee_id: 'ho.own1',       name: 'S. Kulkarni',      role: 'owner',      home_bu: 'HO',    designation: 'Head - Corporate Finance' },
  { employee_id: 'facor.own1',    name: 'U. Behera',        role: 'owner',      home_bu: 'FACOR', designation: 'Head - Smelter Operations' },
  { employee_id: 'facor.own2',    name: 'Y. Mishra',        role: 'owner',      home_bu: 'FACOR', designation: 'Head - Commercial' },

  { employee_id: 'esl.cont1',     name: 'R. Verma',         role: 'contributor', home_bu: 'ESL',  designation: 'Engineer - Process' },
  { employee_id: 'iok.cont1',     name: 'M. Hegde',         role: 'contributor', home_bu: 'IOK',  designation: 'Engineer - Mine Planning' },
  { employee_id: 'facor.cont1',   name: 'S. Rout',          role: 'contributor', home_bu: 'FACOR', designation: 'Engineer - Furnace' },
  { employee_id: 'esl.view1',     name: 'P. Ghosh',         role: 'viewer',      home_bu: 'ESL',  designation: 'Analyst - Finance' },
  { employee_id: 'iob.view1',     name: 'A. Kamath',        role: 'viewer',      home_bu: 'IOB',  designation: 'Analyst - Business Planning' },
];

/**
 * The portfolio. `t` is the full-year target in Rs Cr, `cat` the EBITDA lever,
 * `dep` the owning department and `own` the initiative owner's employee_id.
 */
const INITIATIVES = [
  /* ---------------------------- ESL - 34.00 Cr ---------------------------- */
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own1', cat: 'ENE', t: 4.20, title: 'Coke rate reduction in blast furnace', desc: 'Raise pulverised coal injection and improve burden distribution to cut coke rate by 12 kg/thm.' },
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own1', cat: 'ENE', t: 3.60, title: 'PCI rate enhancement to 180 kg/thm', desc: 'Grinding and injection lance upgrades to lift sustained PCI rate.' },
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own1', cat: 'YLD', t: 2.10, title: 'Sinter basicity and RDI optimisation', desc: 'Stabilise sinter chemistry to improve furnace productivity and reduce flux consumption.' },
  { bu: 'ESL', dep: 'ESL-SCM', own: 'esl.own3', cat: 'RAW', t: 3.80, title: 'Iron ore fines blending cost optimisation', desc: 'Re-optimise the ore blend across captive and market sources against landed cost per Fe unit.' },
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own2', cat: 'ENE', t: 2.40, title: 'Specific power consumption - SMS', desc: 'Reduce kWh per tonne of crude steel through transformer tap optimisation and idle-time control.' },
  { bu: 'ESL', dep: 'ESL-MNT', own: 'esl.own2', cat: 'SPR', t: 1.75, title: 'Ladle refractory life extension', desc: 'Change refractory grade and gunning practice to raise ladle campaign life from 62 to 78 heats.' },
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own2', cat: 'YLD', t: 2.95, title: 'Rebar yield improvement - bar mill', desc: 'Cut cobble and crop losses through roll pass redesign and improved shear setting.' },
  { bu: 'ESL', dep: 'ESL-SCM', own: 'esl.own3', cat: 'LOG', t: 3.20, title: 'Inbound rake cycle optimisation', desc: 'Reduce demurrage and improve rake turnaround at the plant sidings.' },
  { bu: 'ESL', dep: 'ESL-MNT', own: 'esl.own2', cat: 'CON', t: 2.50, title: 'Contract labour productivity programme', desc: 'Rebase contractor manning against benchmarked norms across maintenance packages.' },
  { bu: 'ESL', dep: 'ESL-SCM', own: 'esl.own3', cat: 'SPR', t: 2.20, title: 'Spares indigenisation programme', desc: 'Localise 40 high-value imported spares with qualified domestic vendors.' },
  { bu: 'ESL', dep: 'ESL-COM', own: 'esl.own3', cat: 'SLS', t: 3.90, title: 'Value-added product mix uplift', desc: 'Shift mix towards higher realisation grades within existing rolling capacity.' },
  { bu: 'ESL', dep: 'ESL-OPS', own: 'esl.own1', cat: 'DIG', t: 1.40, title: 'Digital yield analytics deployment', desc: 'Model-based yield loss detection across the sinter, BF and SMS chain.' },

  /* ---------------------------- IOK - 21.00 Cr ---------------------------- */
  { bu: 'IOK', dep: 'IOK-OPS', own: 'iok.own2', cat: 'YLD', t: 3.40, title: 'Beneficiation plant yield uplift', desc: 'Improve weight recovery through spiral circuit rebalancing and feed size control.' },
  { bu: 'IOK', dep: 'IOK-OPS', own: 'iok.own2', cat: 'ENE', t: 2.10, title: 'Crusher circuit energy reduction', desc: 'Reduce specific energy per tonne crushed through liner profile and choke feed control.' },
  { bu: 'IOK', dep: 'IOK-OPS', own: 'iok.own1', cat: 'ENE', t: 2.75, title: 'Mining fleet fuel efficiency', desc: 'Telematics-led idling reduction and haul road gradient correction across the HEMM fleet.' },
  { bu: 'IOK', dep: 'IOK-OPS', own: 'iok.own1', cat: 'CON', t: 1.60, title: 'Drill and blast powder factor optimisation', desc: 'Optimise blast design to cut explosive cost per tonne while holding fragmentation.' },
  { bu: 'IOK', dep: 'IOK-COM', own: 'iok.own1', cat: 'SPR', t: 2.30, title: 'HEMM spares localisation', desc: 'Qualify domestic sources for high-consumption earthmoving spares.' },
  { bu: 'IOK', dep: 'IOK-COM', own: 'iok.own1', cat: 'CON', t: 2.90, title: 'Contractor rate benchmarking', desc: 'Rebid mining and support contracts against a benchmarked rate card.' },
  { bu: 'IOK', dep: 'IOK-LOG', own: 'iok.own1', cat: 'LOG', t: 2.45, title: 'Rake loading cycle time reduction', desc: 'Cut siding placement to release time to avoid railway demurrage.' },
  { bu: 'IOK', dep: 'IOK-LOG', own: 'iok.own1', cat: 'LOG', t: 1.95, title: 'Road transport route optimisation', desc: 'Re-plan despatch routing and trip mix to lower cost per tonne-kilometre.' },
  { bu: 'IOK', dep: 'IOK-OPS', own: 'iok.own2', cat: 'YLD', t: 1.55, title: 'Screening plant availability improvement', desc: 'Raise plant availability through predictive screen deck replacement.' },

  /* ---------------------------- IOG - 13.50 Cr ---------------------------- */
  { bu: 'IOG', dep: 'IOG-OPS', own: 'iog.own1', cat: 'YLD', t: 2.60, title: 'Tailings iron recovery', desc: 'Recover saleable fines from legacy tailings through a hydrocyclone circuit.' },
  { bu: 'IOG', dep: 'IOG-LOG', own: 'iog.own1', cat: 'LOG', t: 2.25, title: 'Barge freight renegotiation', desc: 'Consolidate barge operators and move to an indexed rate structure.' },
  { bu: 'IOG', dep: 'IOG-COM', own: 'iog.own1', cat: 'RAW', t: 1.40, title: 'Explosive supply consolidation', desc: 'Single-source explosives across Goa operations at consolidated volume pricing.' },
  { bu: 'IOG', dep: 'IOG-LOG', own: 'iog.own1', cat: 'LOG', t: 2.10, title: 'Port handling charge reduction', desc: 'Renegotiate stevedoring and plot rental at the loading port.' },
  { bu: 'IOG', dep: 'IOG-LOG', own: 'iog.own1', cat: 'LOG', t: 1.85, title: 'Inland transport contract restructure', desc: 'Move inland haulage from fixed to performance-linked contracting.' },
  { bu: 'IOG', dep: 'IOG-OPS', own: 'iog.own1', cat: 'ENE', t: 1.55, title: 'Dewatering pump energy optimisation', desc: 'Right-size pit dewatering pumps and shift duty cycles off peak tariff.' },
  { bu: 'IOG', dep: 'IOG-COM', own: 'iog.own1', cat: 'OVH', t: 1.75, title: 'Statutory and lease cost review', desc: 'Review lease, royalty and statutory charge base for recoverable overpayments.' },

  /* ---------------------------- VAB - 14.20 Cr ---------------------------- */
  { bu: 'VAB', dep: 'VAB-OPS', own: 'vab.own1', cat: 'ENE', t: 3.30, title: 'Pellet plant thermal efficiency', desc: 'Reduce kcal per tonne of pellet through burner tuning and waste heat recovery.' },
  { bu: 'VAB', dep: 'VAB-OPS', own: 'vab.own1', cat: 'YLD', t: 2.85, title: 'Pig iron specific coke reduction', desc: 'Lower coke per tonne of hot metal in the mini blast furnace route.' },
  { bu: 'VAB', dep: 'VAB-OPS', own: 'vab.own1', cat: 'RAW', t: 1.70, title: 'Bentonite consumption reduction', desc: 'Optimise binder dosage against green ball drop number and moisture.' },
  { bu: 'VAB', dep: 'VAB-COM', own: 'vab.own1', cat: 'SLS', t: 3.15, title: 'Pellet grade mix optimisation', desc: 'Shift the grade mix towards higher netback pellet grades.' },
  { bu: 'VAB', dep: 'VAB-OPS', own: 'vab.own1', cat: 'SPR', t: 1.60, title: 'Kiln refractory campaign life', desc: 'Extend the grate-kiln refractory campaign through profile and cooling changes.' },
  { bu: 'VAB', dep: 'VAB-OPS', own: 'vab.own1', cat: 'SPR', t: 1.60, title: 'Grinding media consumption reduction', desc: 'Change media alloy and charge pattern to cut consumption per tonne ground.' },

  /* ----------------------------- HO - 9.30 Cr ----------------------------- */
  { bu: 'HO', dep: 'HO-FIN', own: 'ho.own1', cat: 'WCP', t: 2.80, title: 'Working capital release - receivables', desc: 'Reduce days sales outstanding through collection discipline and credit policy reset.' },
  { bu: 'HO', dep: 'HO-FIN', own: 'ho.own1', cat: 'WCP', t: 2.15, title: 'Input tax credit optimisation', desc: 'Recover blocked and lapsed input tax credit across the Iron Ore Business.' },
  { bu: 'HO', dep: 'HO-ADM', own: 'ho.own1', cat: 'OVH', t: 1.45, title: 'Insurance premium consolidation', desc: 'Consolidate policies across units into a single negotiated programme.' },
  { bu: 'HO', dep: 'HO-ADM', own: 'ho.own1', cat: 'OVH', t: 1.60, title: 'Shared services consolidation', desc: 'Move transactional finance and HR activity into a shared service centre.' },
  { bu: 'HO', dep: 'HO-FIN', own: 'ho.own1', cat: 'WCP', t: 1.30, title: 'Treasury and banking charge review', desc: 'Rationalise bank charges, LC costs and idle balances across accounts.' },

  /* --------------------------- FACOR - 19.40 Cr --------------------------- */
  { bu: 'FACOR', dep: 'FAC-OPS', own: 'facor.own1', cat: 'ENE', t: 3.10, title: 'Furnace power factor improvement', desc: 'Install capacitor banks and rebalance electrode regulation on the submerged arc furnaces.' },
  { bu: 'FACOR', dep: 'FAC-OPS', own: 'facor.own1', cat: 'YLD', t: 2.70, title: 'Chrome recovery in beneficiation', desc: 'Improve Cr2O3 recovery through spiral and table circuit changes.' },
  { bu: 'FACOR', dep: 'FAC-OPS', own: 'facor.own1', cat: 'SPR', t: 1.85, title: 'Refractory life - submerged arc furnace', desc: 'Extend furnace campaign life through lining design and cooling improvements.' },
  { bu: 'FACOR', dep: 'FAC-COM', own: 'facor.own2', cat: 'RAW', t: 2.60, title: 'Coke consumption per tonne of alloy', desc: 'Reduce reductant consumption through sizing control and charge mix change.' },
  { bu: 'FACOR', dep: 'FAC-COM', own: 'facor.own2', cat: 'RAW', t: 2.35, title: 'Chrome ore sourcing mix', desc: 'Rebalance captive versus purchased chrome ore against landed cost per unit Cr.' },
  { bu: 'FACOR', dep: 'FAC-COM', own: 'facor.own2', cat: 'LOG', t: 2.10, title: 'Export logistics cost reduction', desc: 'Renegotiate port, handling and ocean freight terms for alloy exports.' },
  { bu: 'FACOR', dep: 'FAC-OPS', own: 'facor.own1', cat: 'ENE', t: 2.40, title: 'Power tariff and open access', desc: 'Shift a share of load to open access and renewable sources at lower landed tariff.' },
  { bu: 'FACOR', dep: 'FAC-FIN', own: 'facor.own2', cat: 'WCP', t: 1.15, title: 'Inventory carrying cost reduction', desc: 'Cut ore and alloy inventory days through demand-linked stocking norms.' },
  { bu: 'FACOR', dep: 'FAC-OPS', own: 'facor.own1', cat: 'YLD', t: 1.15, title: 'Slag reprocessing recovery', desc: 'Recover entrained metal from slag dumps through crushing and jigging.' },
];

/** Task templates, picked deterministically per initiative. */
const TASK_TEMPLATES = [
  'Baseline the current cost driver and agree the measurement basis with Finance',
  'Complete technical feasibility and quantify the addressable saving',
  'Obtain capital or expense approval from the investment committee',
  'Float enquiry and complete vendor or contractor selection',
  'Run the pilot on one line or one section and validate the saving',
  'Roll out across remaining sections',
  'Agree the monthly booking methodology with the PMO office',
  'Update the standard operating procedure and train the operating team',
  'Close out and hand over to line ownership for sustenance',
];

const MILESTONE_TEMPLATES = [
  'Baseline signed off by Finance',
  'Feasibility approved',
  'Pilot completed and saving validated',
  'Full rollout complete',
  'Sustenance handover',
];

const RISK_TEMPLATES = [
  { title: 'Benefit basis not agreed with Finance', mitigation: 'Joint working session with the BU finance controller to lock the measurement basis before booking.' },
  { title: 'Vendor capacity constraint may delay rollout', mitigation: 'Second source qualified in parallel; phased order placement.' },
  { title: 'Capital approval pending beyond planned date', mitigation: 'Escalated to the investment committee; interim expense route being evaluated.' },
  { title: 'Operating team bandwidth during peak production', mitigation: 'Rollout scheduled around the shutdown calendar.' },
  { title: 'Commodity price movement erodes the calculated saving', mitigation: 'Saving indexed to a fixed base price; variance reported separately.' },
  { title: 'Statutory or regulatory clearance outstanding', mitigation: 'Application filed; weekly follow-up with the nodal officer.' },
];

module.exports = {
  CATEGORIES, DEPARTMENTS, USERS, INITIATIVES,
  TASK_TEMPLATES, MILESTONE_TEMPLATES, RISK_TEMPLATES,
};
