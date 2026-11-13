import "server-only";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { run, get } from "./db";
import {
  OPEN_STAGES, STAGE_PROBABILITY, LEAD_SOURCES, TASK_PRIORITIES, ACTIVITY_TYPES, CASE_TYPES, CASE_PRIORITIES,
  CAMPAIGN_TYPES, CAMPAIGN_CHANNELS, SOURCING_STATUSES,
} from "./config";

/** Deterministic pseudo-random generator so every fresh install gets the same demo data. */
function prng(seedNum: number) {
  let a = seedNum;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ins(table: string, row: Record<string, string | number | null>) {
  const cols = Object.keys(row);
  run(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...cols.map((c) => row[c]));
}

function num(entity: string) {
  const n = get<{ prefix: string; next_number: number; padding: number }>("SELECT * FROM numbering WHERE entity = ?", entity)!;
  run("UPDATE numbering SET next_number = next_number + 1 WHERE entity = ?", entity);
  return `${n.prefix}${String(n.next_number).padStart(n.padding, "0")}`;
}

const sqlDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "Demo@1234";

export function seed() {
  const r = prng(20261109);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const between = (lo: number, hi: number) => Math.floor(lo + r() * (hi - lo + 1));
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000 - between(0, 86_000) * 1000);
  const daysAhead = (d: number) => new Date(Date.now() + d * 86400_000);
  const id = () => crypto.randomUUID();
  const year = new Date().getFullYear();

  /* settings */
  for (const [entity, prefix, padding] of [
    ["leads", "LD-", 5], ["contacts", "CT-", 5], ["accounts", "AC-", 5], ["deals", `M365-OPP-${year}-`, 6],
    ["quotes", `Q-${year}-`, 5], ["tasks", "TK-", 5], ["cases", `CS-${year}-`, 5], ["sourcing", `SR-${year}-`, 5],
  ] as const)
    ins("numbering", { entity, prefix, next_number: 1, padding });
  for (const c of [
    { code: "USD", name: "US Dollar", symbol: "$", rate: 1, is_base: 1 },
    { code: "EUR", name: "Euro", symbol: "€", rate: 0.92, is_base: 0 },
    { code: "GBP", name: "British Pound", symbol: "£", rate: 0.79, is_base: 0 },
    { code: "INR", name: "Indian Rupee", symbol: "₹", rate: 83.2, is_base: 0 },
  ]) ins("currencies", c);
  ins("settings", { key: "approval_threshold", value: "5000000" });

  /* users */
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 11);
  const users = [
    { name: "Maya Iyer", email: "admin@method365.dev", role: "SUPER_ADMIN", avatar_color: "#16a34a" },
    { name: "Daniel Brooks", email: "manager@method365.dev", role: "SALES_MANAGER", avatar_color: "#2563eb" },
    { name: "Neha Kulkarni", email: "sales@method365.dev", role: "SALES_EXECUTIVE", avatar_color: "#0891b2" },
    { name: "Owen Hart", email: "sales2@method365.dev", role: "SALES_EXECUTIVE", avatar_color: "#ea580c" },
    { name: "Grace Lin", email: "exec@method365.dev", role: "MANAGEMENT", avatar_color: "#9333ea" },
  ].map((u) => ({ id: id(), ...u }));
  for (const u of users) ins("users", { ...u, password_hash: hash });
  const admin = users[0], manager = users[1];
  const sellers = users.filter((u) => u.role === "SALES_EXECUTIVE" || u.role === "SALES_MANAGER");

  /* accounts */
  const accountSeeds: [string, string, string, string, string, string][] = [
    ["Northgate Pharma Distributors", "Distributor", "Customer", "Mumbai", "Maharashtra", "India"],
    ["Bluecrest Hospitals", "Healthcare", "Customer", "Boston", "Massachusetts", "United States"],
    ["Silverleaf Biologics", "Biotech", "Prospect", "San Diego", "California", "United States"],
    ["Harborview Wholesale Medical", "Wholesaler", "Customer", "Newark", "New Jersey", "United States"],
    ["Kestrel Life Sciences", "Pharmaceuticals", "Customer", "Basel", "Basel-Stadt", "Switzerland"],
    ["Meadowbrook Pharmacy Group", "Retail", "Prospect", "Ahmedabad", "Gujarat", "India"],
    ["Orchid Medical Supplies", "Distributor", "Partner", "Dubai", "Dubai", "United Arab Emirates"],
    ["Pinecone Clinical Labs", "Research", "Customer", "Austin", "Texas", "United States"],
    ["Riverside Health Network", "Healthcare", "Prospect", "Manchester", "England", "United Kingdom"],
    ["Summit Generics", "Manufacturing", "Supplier", "Hyderabad", "Telangana", "India"],
    ["Tidewater Specialty Pharmacy", "Retail", "Customer", "Miami", "Florida", "United States"],
    ["Valemont Therapeutics", "Pharmaceuticals", "Prospect", "Munich", "Bavaria", "Germany"],
    ["Westfield Medical Devices", "Medical Devices", "Churned", "Chicago", "Illinois", "United States"],
    ["Zenith Cold Chain Logistics", "Distributor", "Supplier", "Pune", "Maharashtra", "India"],
  ];
  const accounts = accountSeeds.map(([name, industry, type, city, state, country]) => {
    const a = { id: id(), name, owner: pick(sellers).id, city, country };
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    const created = daysAgo(between(120, 400));
    ins("accounts", {
      id: a.id, number: num("accounts"), name, type, industry, website: `https://www.${slug}.example`,
      phone: `+1 555 ${between(100, 999)} ${between(1000, 9999)}`, email: `info@${slug}.example`,
      address: `${between(10, 999)} ${pick(["Harbor", "Market", "Park", "Lake", "Hill"])} Road`, city, state, country,
      employees: pick([40, 120, 300, 800, 2500, 10000]), annual_revenue: between(1, 900) * 100_000,
      description: null, owner_id: a.owner, created_at: sqlDate(created), updated_at: sqlDate(created),
    });
    return a;
  });

  /* contacts */
  const first = ["Aisha", "Ben", "Carla", "Dev", "Elena", "Farhan", "Grace", "Hiro", "Isabel", "Jamal", "Kiran", "Laura", "Mateo", "Nadia", "Omar", "Priya", "Rahul", "Sofia", "Tom", "Uma", "Victor", "Yusuf", "Zoe", "Arjun", "Meera"];
  const last = ["Anderson", "Bose", "Chen", "Duarte", "Evans", "Fischer", "Gupta", "Hughes", "Iyer", "Jensen", "Kapoor", "Lopez", "Nakamura", "Okafor", "Park", "Reddy", "Schmidt", "Thompson", "Verma", "Walsh"];
  const titles = ["Procurement Manager", "Head of Supply Chain", "Pharmacy Director", "Operations Manager", "CFO", "Medical Director", "Purchasing Lead", "CEO", "Category Manager", "Executive Manager"];
  const departments = ["Procurement", "Operations", "Pharmacy", "Finance", "Supply Chain"];
  const contacts: { id: string; account: (typeof accounts)[number] }[] = [];
  for (let i = 0; i < 34; i++) {
    const account = accounts[i % accounts.length];
    const fn = pick(first), ln = pick(last);
    const created = daysAgo(between(20, 380));
    const domain = account.name.toLowerCase().replace(/[^a-z]+/g, "");
    const c = { id: id(), account };
    contacts.push(c);
    ins("contacts", {
      id: c.id, number: num("contacts"), first_name: fn, last_name: ln, email: `${fn}.${ln}`.toLowerCase() + `@${domain}.example`,
      phone: `+1 555 ${between(100, 999)} ${between(1000, 9999)}`, mobile: null, title: pick(titles), department: pick(departments),
      status: i % 17 === 16 ? "Archived" : "Active", account_id: account.id, city: account.city, country: account.country,
      description: null, owner_id: account.owner, created_at: sqlDate(created), updated_at: sqlDate(created),
    });
  }

  /* product master */
  const products = ([
    ["0002-7510-01", "Amoxiclav 625 mg tablets", "Product", "Antibiotics", "Summit Generics", "Active", 42, 28],
    ["0074-0243-02", "Adalimumab 40 mg/0.4 ml pen", "Product", "Biologics", "Kestrel Life Sciences", "Active", 2950, 2400],
    ["0310-0750-30", "Daratumumab SC 1800 mg vial", "Product", "Oncology", "Kestrel Life Sciences", "Active", 8700, 7300],
    ["0456-1201-10", "Insulin glargine 100 U/ml cartridge", "Product", "Diabetes", "Summit Generics", "Active", 65, 41],
    ["0186-5020-28", "Esomeprazole 40 mg capsules", "Product", "Gastro", "Summit Generics", "Pending Approval", 18, 9],
    ["MC-INF-200", "Infusion pump IP-200", "Machine", "Devices", "Westfield Medical Devices", "Active", 3400, 2600],
    ["SV-CCL-01", "Cold-chain shipment (per pallet)", "Logistics", "Logistics", "Zenith Cold Chain Logistics", "Active", 480, 350],
    ["SV-AMC-12", "Annual maintenance contract", "Service", "Services", "Westfield Medical Devices", "Active", 1200, 500],
    ["PK-BLS-10", "Blister packaging (per 1,000)", "Packaging", "Packaging", "Summit Generics", "On Hold", 95, 70],
    ["AN-SYR-05", "Safety syringe 5 ml (box of 100)", "Ancillary", "Consumables", "Orchid Medical Supplies", "Discontinued", 22, 14],
  ] as const).map(([sku, name, type, family, manufacturer, status, price, cost]) => {
    const pid = id();
    ins("products", { id: pid, sku, name, category: family, type, family, manufacturer, status, unit_price: price, unit_cost: cost, currency: "USD", tax_rate: 0, active: status === "Active" ? 1 : 0, description: null });
    return { id: pid, name: name as string, price: price as number, active: status === "Active" };
  });
  const sellable = products.filter((p) => p.active);

  /* price books, contracts, margin floors */
  const pbUs = id(), pbIn = id();
  ins("price_books", { id: pbUs, name: "US list prices", region: "North America", currency: "USD", segment: "All customers", valid_from: `${year}-01-01`, valid_to: `${year}-12-31`, active: 1 });
  ins("price_books", { id: pbIn, name: "India distributor prices", region: "India", currency: "USD", segment: "Distributor", valid_from: `${year}-04-01`, valid_to: null, active: 1 });
  for (const p of sellable) {
    ins("price_entries", { id: id(), price_book_id: pbUs, product_id: p.id, min_qty: 1, price: p.price });
    ins("price_entries", { id: id(), price_book_id: pbIn, product_id: p.id, min_qty: 10, price: Math.round(p.price * 0.88) });
  }
  ins("contracts", { id: id(), name: "Bluecrest 2-year biologics agreement", account_id: accounts[1].id, product_id: products[1].id, price: 2700, valid_from: `${year}-01-01`, valid_to: `${year + 1}-12-31` });
  ins("margin_floors", { id: id(), name: "Biologics minimum", segment: "All customers", product_type: "Product", min_margin_pct: 12 });
  ins("margin_floors", { id: id(), name: "Distributor floor", segment: "Distributor", product_type: null, min_margin_pct: 8 });

  /* web forms */
  const formId = id();
  ins("web_forms", {
    id: formId, name: "Website enquiry form", slug: "contact", title: "Talk to our team",
    fields: JSON.stringify(["first_name", "last_name", "email", "phone", "company", "message"]), lead_source: "Web Form",
    success_message: "Thanks! Someone from our team will be in touch within one business day.", active: 1, owner_id: sellers[0].id,
  });

  /* leads */
  const companies = ["Brightpath Clinics", "Coastal Care Pharmacy", "Greenfield Hospital", "Harbor Point Bio", "Lakeside Medical Store", "Maple Healthcare", "Oakridge Health", "Prairie Pharma Traders", "Redwood Trials", "Starlight Bio", "Westbrook Labs"];
  const leadStatuses = ["New", "New", "Contacted", "Contacted", "Qualified", "Proposal Sent", "Negotiation", "Won", "Lost", "Unqualified"];
  for (let i = 0; i < 48; i++) {
    const fn = pick(first), ln = pick(last);
    const created = daysAgo(Math.floor(Math.pow(r(), 1.4) * 300));
    const fromForm = r() < 0.15;
    const company = pick(companies);
    const rating = pick(["Hot", "Warm", "Warm", "Cold"]);
    const value = between(5, 600) * 1000;
    ins("leads", {
      id: id(), number: num("leads"), first_name: fn, last_name: ln, company, title: pick(titles),
      email: `${fn}.${ln}`.toLowerCase() + `@${company.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
      phone: `+1 555 ${between(100, 999)} ${between(1000, 9999)}`, source: fromForm ? "Web Form" : pick(LEAD_SOURCES.filter((s) => s !== "Web Form")),
      status: pick(leadStatuses), rating, estimated_value: value,
      score: Math.min(100, (rating === "Hot" ? 60 : rating === "Warm" ? 40 : 15) + between(0, 30)),
      city: pick(accounts).city, country: null, description: null, web_form_id: fromForm ? formId : null,
      owner_id: r() < 0.1 ? null : pick(sellers).id, created_at: sqlDate(created), updated_at: sqlDate(daysAgo(between(0, 30))),
    });
  }
  // Two submissions the spam checks held back, for the web form review queue.
  for (const [fn, ln, reason] of [["Test", "User", "Honeypot field was filled in"], ["Buy", "Cheap", "Submitted 40 times in one minute"]]) {
    ins("leads", {
      id: id(), number: null, first_name: fn, last_name: ln, company: "—", email: `${fn}.${ln}`.toLowerCase() + "@mailinator.example",
      source: "Web Form", status: "New", web_form_id: formId, held: 1, held_reason: reason, owner_id: null,
      created_at: sqlDate(daysAgo(between(0, 4))), updated_at: sqlDate(daysAgo(0)),
    });
  }

  /* opportunities */
  const deals: { id: string; name: string; account: (typeof accounts)[number]; stage: string; created: Date; amount: number; owner: string }[] = [];
  const dealKinds = ["Annual supply agreement", "Biologics tender", "Oncology portfolio", "Cold-chain logistics", "Device rollout", "Generics range listing", "Hospital formulary", "Distributor onboarding", "Maintenance renewal"];
  for (let i = 0; i < 46; i++) {
    const account = pick(accounts);
    const age = between(3, 360);
    const created = daysAgo(age);
    const open = age < 150 && r() < 0.75;
    const stage = open ? pick(OPEN_STAGES) : r() < 0.6 ? "Won" : "Lost";
    const closeDate = new Date(created.getTime() + between(20, 110) * 86400_000);
    const closedAt = !open ? new Date(Math.min(closeDate.getTime(), Date.now() - 86400_000)) : null;
    const contact = contacts.find((c) => c.account.id === account.id);
    const amount = Math.round(between(5, 900) * 1000 * (r() < 0.08 ? 20 : 1) / 100) * 100;
    const owner = r() < 0.08 ? null : account.owner;
    const d = { id: id(), name: `${account.name} — ${pick(dealKinds)}`, account, stage, created, amount, owner: owner ?? "" };
    deals.push(d);
    const forecast = stage === "Verbal Approval" ? "Commit" : stage === "Negotiation" ? pick(["Commit", "Best Case"]) : stage === "Proposal Sent" ? "Best Case" : "Pipeline";
    ins("deals", {
      id: d.id, number: num("deals"), name: d.name, account_id: account.id, contact_id: contact?.id ?? null, stage,
      amount, currency: "USD", probability: STAGE_PROBABILITY[stage], forecast_category: forecast,
      close_date: dayStr(closedAt ?? closeDate), source: pick(LEAD_SOURCES), next_step: open ? pick(["Send proposal", "Schedule demo", "Pricing review", "Legal review", "Follow-up call"]) : null,
      description: null, closed_at: closedAt ? sqlDate(closedAt) : null, owner_id: owner,
      created_at: sqlDate(created), updated_at: sqlDate(closedAt ?? created),
    });
  }

  /* quotes */
  for (const d of deals.filter((x) => ["Proposal Sent", "Negotiation", "Verbal Approval", "Won"].includes(x.stage)).slice(0, 16)) {
    const qid = id();
    const items = Array.from({ length: between(1, 3) }, () => pick(sellable));
    const qty = between(5, 200);
    const subtotal = items.reduce((s, p, i) => s + p.price * (i === 0 ? qty : 1), 0);
    const discount = pick([0, 0, 5, 10]);
    const status = d.stage === "Won" ? "Accepted" : pick(["Draft", "Submitted", "Approved", "Issued", "Expired"]);
    const contact = contacts.find((c) => c.account.id === d.account.id);
    ins("quotes", {
      id: qid, number: num("quotes"), subject: `Quotation — ${d.name.split(" — ")[1]}`, deal_id: d.id, account_id: d.account.id,
      contact_id: contact?.id ?? null, status, currency: "USD", valid_until: dayStr(daysAhead(between(-10, 40))), discount_pct: discount, tax_pct: 0,
      subtotal, total: Math.round(subtotal * (1 - discount / 100) * 100) / 100,
      terms: "Payment due within 30 days of invoice. Prices exclude applicable taxes.", owner_id: d.account.owner,
      created_at: sqlDate(d.created), updated_at: sqlDate(d.created),
    });
    items.forEach((p, i) => ins("quote_items", { id: id(), quote_id: qid, product_id: p.id, description: p.name, quantity: i === 0 ? qty : 1, unit_price: p.price, position: i }));
  }

  /* tasks */
  const taskTitles = ["Follow up on quotation", "Send contract draft", "Prepare product demo", "Call to qualify", "Review pricing", "Book site visit", "Confirm cold-chain slot", "Send product dossier", "Check in after tender"];
  for (let i = 0; i < 30; i++) {
    const d = pick(deals);
    const due = new Date(Date.now() + between(-8, 21) * 86400_000);
    const status = due.getTime() < Date.now() - 3 * 86400_000 ? pick(["Done", "Done", "Open"]) : pick(["Open", "Open", "In Progress"]);
    const owner = d.account.owner;
    ins("tasks", {
      id: id(), number: num("tasks"), title: pick(taskTitles), due_date: dayStr(due), priority: pick(TASK_PRIORITIES), status,
      description: null, related_type: "opportunities", related_id: d.id, owner_id: owner, created_by: owner,
      completed_at: status === "Done" ? sqlDate(due) : null,
    });
  }

  /* activities (past and upcoming, so the calendar has something in it) */
  const subjects: Record<string, string[]> = {
    Call: ["Discovery call", "Pricing discussion", "Check-in call", "Intro call"],
    Email: ["Sent quotation", "Shared product dossier", "Answered tender questions", "Sent meeting recap"],
    Meeting: ["Product demo", "On-site visit", "Kick-off meeting", "Quarterly business review"],
    Note: ["Budget confirmed for next quarter", "Decision maker identified", "Competitor also in evaluation", "Requested quality certificates"],
  };
  for (let i = 0; i < 110; i++) {
    const type = pick(ACTIVITY_TYPES);
    const d = pick(deals);
    const when = i < 18 ? new Date(daysAhead(between(0, 25)).setUTCHours(between(4, 12), pick([0, 30]), 0, 0)) : daysAgo(between(0, 200));
    ins("activities", {
      id: id(), type, subject: pick(subjects[type]), body: null, occurred_at: sqlDate(when),
      duration_min: type === "Call" || type === "Meeting" ? pick([15, 30, 45, 60]) : null,
      related_type: "opportunities", related_id: d.id, owner_id: d.account.owner, created_at: sqlDate(when), updated_at: sqlDate(when),
    });
  }

  /* cases */
  const caseSubjects = ["Damaged cartons on delivery", "Temperature excursion during transit", "Request for certificate of analysis", "Short shipment against PO", "Invoice price does not match quote", "Device alarm fault", "Follow-up on returned stock"];
  for (let i = 0; i < 9; i++) {
    const a = pick(accounts);
    const type = pick(CASE_TYPES);
    const status = pick(["New", "In Progress", "Awaiting Customer", "Resolved", "Closed"]);
    const opened = daysAgo(between(1, 60));
    ins("cases", {
      id: id(), number: num("cases"), subject: pick(caseSubjects), type, priority: pick(CASE_PRIORITIES), status,
      account_id: a.id, contact_id: contacts.find((c) => c.account.id === a.id)?.id ?? null, deal_id: null,
      product_id: pick(products).id, lot_number: `L${between(10000, 99999)}`, sla_due: dayStr(new Date(opened.getTime() + between(2, 14) * 86400_000)),
      description: null, resolution: null, closed_at: ["Resolved", "Closed"].includes(status) ? sqlDate(daysAgo(between(0, 5))) : null,
      owner_id: a.owner, created_at: sqlDate(opened), updated_at: sqlDate(opened),
    });
  }

  /* campaigns */
  for (const [name, status, start] of [
    ["Hospital pharmacy summit", "Completed", -90], ["Biologics webinar series", "Active", -12], ["Distributor referral programme", "Active", -40],
    ["Q-end email programme", "Planned", 14], ["Trade fair booth", "Planned", 45],
  ] as const) {
    const budget = between(5, 60) * 1000;
    ins("campaigns", {
      id: id(), name, type: pick(CAMPAIGN_TYPES), status, channel: pick(CAMPAIGN_CHANNELS),
      start_date: dayStr(daysAhead(start)), end_date: dayStr(daysAhead(start + between(7, 60))), budget,
      actual_cost: status === "Planned" ? 0 : Math.round(budget * (0.3 + r() * 0.7)), expected_leads: between(10, 120),
      description: null, owner_id: manager.id,
    });
  }

  /* approvals: one per large open opportunity */
  for (const d of deals.filter((x) => OPEN_STAGES.includes(x.stage) && x.amount > 5_000_000).slice(0, 3)) {
    ins("approvals", {
      id: id(), policy: "Opportunity above 5,000,000", status: "Pending", related_type: "opportunities", related_id: d.id,
      raised_by: d.owner || admin.id, waiting_on: "Sales Manager", steps_done: 0, steps_total: 1, due_date: dayStr(daysAhead(between(-2, 5))),
    });
  }
  const decided = deals.find((x) => x.stage === "Won");
  if (decided) ins("approvals", {
    id: id(), policy: "Quote discount above 10%", status: "Approved", related_type: "opportunities", related_id: decided.id,
    raised_by: sellers[0].id, waiting_on: "Sales Manager", steps_done: 1, steps_total: 1, due_date: dayStr(daysAgo(20)),
    decided_by: manager.id, decided_at: sqlDate(daysAgo(21)), comment: "Volume justifies it.",
  });

  /* sourcing */
  for (const d of deals.filter((x) => OPEN_STAGES.includes(x.stage)).slice(0, 5)) {
    const status = pick(SOURCING_STATUSES.slice(0, 6));
    const p = pick(sellable);
    ins("sourcing_requests", {
      id: id(), number: num("sourcing"), supplier: pick(["Summit Generics", "Zenith Cold Chain Logistics", "Orchid Medical Supplies"]),
      deal_id: d.id, product_id: p.id, quantity: between(10, 500), status,
      offer_price: ["Responded", "Awarded"].includes(status) ? Math.round(p.price * 0.8) : null, lead_time_days: between(7, 45),
      reply_due: dayStr(daysAhead(between(-3, 10))), notes: null, owner_id: d.owner || admin.id,
    });
  }

  /* documents */
  for (const [name, category, type, kb] of [
    ["Northgate supply agreement.pdf", "Contract", "PDF", 812], ["Bluecrest biologics proposal.docx", "Proposal", "DOCX", 41],
    ["Q3 business review.pptx", "Presentation", "PPTX", 2300], ["Price list FY.xlsx", "Report", "XLSX", 96],
  ] as const) {
    const a = pick(accounts);
    ins("documents", { id: id(), name, category, file_type: type, account_id: a.id, access: pick(["Team", "Team", "Private"]), size_kb: kb, version: 1, url: null, description: null, owner_id: a.owner });
  }

  /* migration */
  ins("migration_runs", { id: id(), name: "Legacy CRM accounts — trial 1", source_system: "Legacy CRM", entity: "account", status: "Reconciled", source_count: 1240, loaded_count: 1228, rejected_count: 12, notes: "12 rows missing a company name." });

  /* notifications */
  for (const t of ["Welcome to method365 CRM", "3 approvals are waiting on a sales manager", "A web form submission was held for review"])
    ins("notifications", { user_id: admin.id, title: t, href: t.includes("approval") ? "/approvals" : t.includes("held") ? "/leads/review-queue" : "/dashboard" });
}
