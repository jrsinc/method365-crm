import {
  ACCOUNT_TYPES, ACTIVITY_TYPES, APPROVAL_ROLES, APPROVAL_STATUSES, CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, CAMPAIGN_TYPES,
  CASE_PRIORITIES, CASE_STATUSES, CASE_TYPES, CONTACT_STATUSES, CONTACT_TYPES, DEAL_STAGES, DOCUMENT_ACCESS, DOCUMENT_CATEGORIES,
  FORECAST_CATEGORIES, INDUSTRIES, LEAD_RATINGS, LEAD_SOURCES, LEAD_STATUSES, MIGRATION_ENTITIES, MIGRATION_STATUSES, NEXT_STEPS, DOSAGE_FORMS,
  PRICE_SEGMENTS, PRODUCT_STATUSES, PRODUCT_TYPES, QUOTE_STATUSES, SOURCING_STATUSES, SUPPLIER_CATEGORIES, SUPPLIER_STATUSES,
  TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES,
  WEB_FORM_FIELDS, type Permission,
} from "./config";
import { MATERIAL_ID_TYPES } from "./goods";

export type FieldType =
  | "text" | "email" | "phone" | "url" | "textarea" | "number" | "money" | "percent"
  | "date" | "datetime" | "select" | "ref" | "user" | "currency" | "checkbox" | "multicheck"
  /** A quote address: "Account default", "Same as bill to" or a custom address. */
  | "address"
  /** Dropdown of every country; "state" lists the states of the country in `countryField`. */
  | "country" | "state";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Select that also offers "Other…": the person types their own value, which is saved as typed (not added to the list). */
  other?: boolean;
  ref?: ResourceKey;
  required?: boolean;
  list?: boolean;
  filter?: boolean;
  readOnly?: boolean;
  default?: string | number;
  full?: boolean;
  currencyField?: string;
  help?: string;
  /** Text field that suggests existing records' names as you type (a new name can still be typed). */
  suggest?: ResourceKey;
  /** Ref dropdown that only lists records belonging to the record chosen in this other field (e.g. "account_id"). */
  filterBy?: string;
  /** For a "state" field: the field holding the country. */
  countryField?: string;
};

export type ResourceKey =
  | "leads" | "contacts" | "accounts" | "opportunities" | "catalogue" | "quotes" | "tasks" | "activities" | "forms"
  | "cases" | "campaigns" | "approvals" | "sourcing" | "suppliers" | "documents"
  | "price-books" | "price-entries" | "supplier-prices" | "contracts" | "margin-floors" | "migration";

/** Reference dropdowns that can create a missing record on the spot from just its name. */
export const QUICK_ADD: ResourceKey[] = ["accounts", "suppliers", "contacts", "opportunities", "catalogue", "price-books"];
export const NEW_REF = "__new__";
/** The "Other…" choice in a dropdown that accepts a typed value (Field.other). */
export const OTHER_REF = "__other__";

/**
 * Dropdowns that drive workflow logic (probabilities, approvals, closing dates, SLA…), so new options
 * can't be added on the fly. Every other dropdown offers "+ Add new option…".
 */
export const LOCKED_PICKLISTS = [
  "opportunities.stage", "opportunities.forecast_category", "tasks.status", "quotes.status", "cases.status",
  "approvals.status", "approvals.waiting_on", "sourcing.status", "migration.status", "migration.entity", "catalogue.status",
];

export type RelatedList = { resource: ResourceKey; fk: string; label: string };

export type ResourceDef = {
  key: ResourceKey;
  table: string;
  label: string;
  singular: string;
  numberEntity?: string;
  numberField?: string;
  /** Column holding the owner. Users without records.read.all only see their own rows. */
  ownerField: "owner_id" | null;
  /** When set, writes need this permission and every user may read all rows. */
  managePerm?: Permission;
  /** SQL expression for a human-readable title; `a` is the table alias. */
  titleSql: (a: string) => string;
  /** Extra condition every list applies (e.g. hide held web-form leads). */
  baseWhere?: (a: string) => string;
  searchable: string[];
  defaultSort: string;
  polymorphic?: boolean;
  timeline?: boolean;
  related?: RelatedList[];
  bulkFields?: string[];
  importable?: boolean;
  fields: Field[];
};

const owner: Field = { name: "owner_id", label: "Owner", type: "user", list: true, filter: true };

export const RESOURCES: Record<ResourceKey, ResourceDef> = {
  leads: {
    key: "leads", table: "leads", label: "Leads", singular: "Lead",
    numberEntity: "leads", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `TRIM(${a}.first_name || ' ' || COALESCE(${a}.last_name,''))`,
    baseWhere: (a) => `${a}.held = 0`,
    searchable: ["number", "first_name", "last_name", "company", "email", "phone"],
    defaultSort: "updated_at", timeline: true, importable: true,
    bulkFields: ["status", "rating", "source"],
    fields: [
      { name: "number", label: "Lead #", type: "text", readOnly: true },
      { name: "first_name", label: "First name", type: "text", required: true },
      { name: "last_name", label: "Last name", type: "text" },
      { name: "company", label: "Company", type: "text", list: true, suggest: "accounts", help: "Pick a company from the list or type a new one." },
      { name: "title", label: "Job title", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone", type: "phone" },
      { name: "status", label: "Status", type: "select", options: LEAD_STATUSES, default: "New", required: true, list: true, filter: true },
      { name: "source", label: "Source", type: "select", options: LEAD_SOURCES, list: true, filter: true },
      owner,
      { name: "estimated_value", label: "Expected value", type: "money", list: true },
      { name: "score", label: "Score", type: "number", list: true, help: "0–100. Left blank, it is worked out from the rating, value and activity." },
      { name: "rating", label: "Rating", type: "select", options: LEAD_RATINGS, filter: true },
      { name: "website", label: "Website", type: "url" },
      { name: "country", label: "Country", type: "country" },
      { name: "state", label: "State / region", type: "state", countryField: "country" },
      { name: "city", label: "City", type: "text" },
      { name: "description", label: "Notes", type: "textarea", full: true },
    ],
  },
  contacts: {
    key: "contacts", table: "contacts", label: "Contacts", singular: "Contact",
    numberEntity: "contacts", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `TRIM(${a}.first_name || ' ' || COALESCE(${a}.last_name,''))`,
    searchable: ["number", "first_name", "last_name", "email", "phone", "mobile", "title"],
    defaultSort: "created_at", timeline: true, importable: true,
    bulkFields: ["contact_type", "status"],
    related: [
      { resource: "opportunities", fk: "contact_id", label: "Opportunities" },
      { resource: "quotes", fk: "contact_id", label: "Quotes" },
    ],
    fields: [
      { name: "number", label: "Contact #", type: "text", readOnly: true },
      { name: "first_name", label: "First name", type: "text", required: true },
      { name: "last_name", label: "Last name", type: "text" },
      { name: "account_id", label: "Company", type: "ref", ref: "accounts", list: true },
      { name: "contact_type", label: "Type", type: "select", options: CONTACT_TYPES, list: true, filter: true, help: "e.g. Existing customer or New lead. Pick \"+ Add new option\" for another type." },
      { name: "title", label: "Job title", type: "text" },
      { name: "department", label: "Department", type: "text" },
      { name: "email", label: "Email", type: "email", list: true },
      { name: "phone", label: "Phone", type: "phone", list: true },
      { name: "mobile", label: "Mobile", type: "phone" },
      { name: "status", label: "Status", type: "select", options: CONTACT_STATUSES, default: "Active", required: true, list: true, filter: true },
      { name: "website", label: "Website", type: "url", help: "Left blank, the company's website is used. A new one is also added to the company if it has none." },
      owner,
      { name: "address", label: "Address (optional)", type: "text", full: true },
      { name: "country", label: "Country", type: "country" },
      { name: "state", label: "State / region", type: "state", countryField: "country" },
      { name: "city", label: "City", type: "text" },
      { name: "description", label: "Notes", type: "textarea", full: true },
    ],
  },
  accounts: {
    key: "accounts", table: "accounts", label: "Accounts", singular: "Account",
    numberEntity: "accounts", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `${a}.name`,
    searchable: ["number", "name", "website", "email", "phone", "city", "industry"],
    defaultSort: "name", timeline: true, importable: true,
    bulkFields: ["type", "industry"],
    related: [
      { resource: "contacts", fk: "account_id", label: "Contacts" },
      { resource: "opportunities", fk: "account_id", label: "Opportunities" },
      { resource: "quotes", fk: "account_id", label: "Quotes" },
      { resource: "cases", fk: "account_id", label: "Cases" },
      { resource: "documents", fk: "account_id", label: "Documents" },
    ],
    fields: [
      { name: "number", label: "Account #", type: "text", readOnly: true },
      { name: "name", label: "Account name", type: "text", required: true },
      { name: "industry", label: "Industry", type: "select", options: INDUSTRIES, list: true, filter: true },
      { name: "type", label: "Account type", type: "select", options: ACCOUNT_TYPES, default: "Prospect", list: true, filter: true },
      { name: "website", label: "Website", type: "url", help: "Shown on this company's contacts that have no website of their own." },
      { name: "phone", label: "Phone", type: "phone" },
      { name: "email", label: "Email", type: "email" },
      { name: "employees", label: "Employees", type: "number" },
      { name: "address", label: "Address", type: "text", full: true },
      { name: "country", label: "Country", type: "country" },
      { name: "state", label: "State / region", type: "state", countryField: "country" },
      { name: "city", label: "City", type: "text" },
      { name: "zip", label: "Zip / postal code", type: "text" },
      { name: "billing_address", label: "Default bill-to address", type: "textarea", help: "Used on quotes. Leave blank to use the address above." },
      { name: "shipping_address", label: "Default ship-to address", type: "textarea", help: "Used on quotes. Leave blank to use the bill-to address." },
      owner,
      { name: "annual_revenue", label: "Annual revenue", type: "money", list: true },
      { name: "description", label: "Description", type: "textarea", full: true },
    ],
  },
  opportunities: {
    key: "opportunities", table: "deals", label: "Opportunities", singular: "Opportunity",
    numberEntity: "deals", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `${a}.name`,
    searchable: ["number", "name", "next_step"],
    defaultSort: "created_at", timeline: true,
    bulkFields: ["stage", "forecast_category"],
    related: [
      { resource: "quotes", fk: "deal_id", label: "Quotes" },
      { resource: "sourcing", fk: "deal_id", label: "Sourcing requests" },
      { resource: "cases", fk: "deal_id", label: "Cases" },
    ],
    fields: [
      { name: "name", label: "Opportunity", type: "text", required: true },
      { name: "number", label: "Number", type: "text", readOnly: true, list: true },
      { name: "account_id", label: "Account", type: "ref", ref: "accounts", list: true },
      { name: "contact_id", label: "Contact", type: "ref", ref: "contacts", filterBy: "account_id" },
      { name: "stage", label: "Stage", type: "select", options: DEAL_STAGES, default: "Lead Generated", required: true, list: true, filter: true },
      { name: "amount", label: "Expected revenue", type: "money", currencyField: "currency", list: true },
      { name: "currency", label: "Currency", type: "currency" },
      { name: "probability", label: "Probability", type: "percent", help: "Left blank, it follows the stage." },
      { name: "forecast_category", label: "Forecast category", type: "select", options: FORECAST_CATEGORIES, default: "Pipeline", filter: true },
      { name: "close_date", label: "Expected close", type: "date" },
      { name: "source", label: "Source", type: "select", options: LEAD_SOURCES },
      { name: "next_step", label: "Next step", type: "select", options: NEXT_STEPS, other: true },
      owner,
      { name: "description", label: "Description", type: "textarea", full: true },
    ],
  },
  catalogue: {
    key: "catalogue", table: "products", label: "Product Master", singular: "Product",
    numberEntity: "products", numberField: "number",
    ownerField: null, managePerm: "products.manage",
    titleSql: (a) => `${a}.name`,
    searchable: ["number", "material_id", "sku", "name", "family", "manufacturer", "hts_code"],
    defaultSort: "name", importable: true,
    bulkFields: ["status", "type"],
    related: [{ resource: "supplier-prices", fk: "product_id", label: "Supplier prices" }],
    fields: [
      { name: "number", label: "Material ID", type: "text", readOnly: true, list: true, help: "Given automatically when the product is saved. Never repeats." },
      { name: "material_id_type", label: "Number type", type: "select", options: MATERIAL_ID_TYPES, default: "NDC", required: true, filter: true },
      { name: "material_id", label: "NDC / DIN number", type: "text", required: true, list: true, help: "Must be unique. The same number with or without dashes or spaces counts as a duplicate." },
      { name: "name", label: "Product title", type: "text", required: true, full: true },
      { name: "dosage_form", label: "Dosage form", type: "select", options: DOSAGE_FORMS, other: true, list: true, filter: true },
      { name: "pack_size", label: "Pack size", type: "text", list: true, help: "e.g. 30 tablets, 1 x 10 mL vial, 28 capsules" },
      { name: "manufacturer", label: "MFG (manufacturer)", type: "text", list: true },
      { name: "lot_number", label: "LOT", type: "text", help: "Leave blank to print TBD." },
      { name: "expiry", label: "EXP (expiry)", type: "text", help: "Date or TBD. Leave blank to print TBD." },
      { name: "hts_code", label: "HTS code", type: "text", list: true },
      { name: "weight_g", label: "Weight (g)", type: "number", help: "Weight of one unit in grams." },
      { name: "length_in", label: "Length (in)", type: "number" },
      { name: "width_in", label: "Width (in)", type: "number" },
      { name: "height_in", label: "Height (in)", type: "number" },
      { name: "uom", label: "Unit (per)", type: "text", default: "EACH", help: "Printed in the \"per\" column, e.g. EACH, BOX, VIAL." },
      { name: "sku", label: "Code", type: "text" },
      { name: "type", label: "Type", type: "select", options: PRODUCT_TYPES, default: "Product", required: true, list: true, filter: true },
      { name: "family", label: "Family", type: "text" },
      { name: "status", label: "Status", type: "select", options: PRODUCT_STATUSES, default: "Active", required: true, list: true, filter: true },
      { name: "unit_price", label: "Sales price", type: "money", currencyField: "currency", required: true, list: true, help: "What the customer pays per unit. Used as the price when the product is added to an opportunity or quote." },
      { name: "unit_cost", label: "Supplier price", type: "money", currencyField: "currency", list: true, help: "What you pay the supplier per unit. Each supplier's own quote is kept under Supplier prices on the product page." },
      { name: "currency", label: "Currency", type: "currency" },
      { name: "tax_rate", label: "Tax rate", type: "percent" },
      { name: "description", label: "Product description", type: "textarea", full: true },
      { name: "remark", label: "Remark", type: "textarea", full: true },
    ],
  },
  quotes: {
    key: "quotes", table: "quotes", label: "Quotes", singular: "Quote",
    numberEntity: "quotes", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `COALESCE(${a}.number, ${a}.subject)`,
    searchable: ["number", "subject"],
    defaultSort: "created_at", timeline: true,
    bulkFields: ["status"],
    fields: [
      { name: "number", label: "Quote #", type: "text", readOnly: true, help: "Given automatically; it can't be changed." },
      { name: "account_id", label: "Account", type: "ref", ref: "accounts", list: true },
      { name: "deal_id", label: "Opportunity", type: "ref", ref: "opportunities", list: true, filterBy: "account_id", help: "Only this account's opportunities. Picking one first fills in its account." },
      { name: "contact_id", label: "Contact", type: "ref", ref: "contacts", filterBy: "account_id", help: "People at this account and the opportunity's contact." },
      { name: "status", label: "Status", type: "select", options: QUOTE_STATUSES, default: "Draft", required: true, list: true, filter: true },
      { name: "total", label: "Total", type: "money", currencyField: "currency", readOnly: true, list: true },
      { name: "currency", label: "Currency", type: "currency" },
      { name: "valid_until", label: "Valid until", type: "date", list: true },
      { name: "discount_pct", label: "Discount", type: "percent", default: 0 },
      { name: "tax_pct", label: "Tax", type: "percent", default: 0 },
      { name: "handling_charge", label: "Handling charge", type: "money", currencyField: "currency", help: "Flat amount added to the total, e.g. handling per sourcing market." },
      { name: "payment_terms", label: "Payment terms", type: "text", help: "e.g. 100% advance, Net 30." },
      { name: "incoterm", label: "Incoterm", type: "select", options: ["EXW", "FCA", "FOB", "CPT", "CIP", "DAP", "DDP"], help: "Who pays freight, customs and insurance." },
      owner,
      { name: "bill_to", label: "Bill to", type: "address", full: true },
      { name: "ship_to", label: "Ship to", type: "address", full: true },
      { name: "customer_note", label: "Note to customer", type: "textarea", full: true, default: "Lot numbers and expiry dates are indicative and confirmed at shipment.", help: "Printed under the total, e.g. shelf life or lot notes." },
      { name: "terms", label: "Disclaimers / terms", type: "textarea", full: true, help: "One per line. Printed on the PDF and listed under the table in the email.",
        default: "All quotes provided are valid for 15 calendar days.\nPricing is subject to any manufacturer price increase at the time of the actual order.\nPrices, availability and lead times are confirmed only on receipt of the purchase order or payment." },
    ],
  },
  tasks: {
    key: "tasks", table: "tasks", label: "Tasks", singular: "Task",
    numberEntity: "tasks", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `${a}.title`,
    searchable: ["number", "title", "description"],
    defaultSort: "due_date", polymorphic: true,
    bulkFields: ["status", "priority"],
    fields: [
      { name: "title", label: "Title", type: "text", required: true, list: true, full: true },
      { name: "category", label: "Type", type: "select", options: TASK_CATEGORIES, default: "General", required: true, list: true, filter: true },
      { name: "due_date", label: "Due date", type: "date", list: true },
      { name: "priority", label: "Priority", type: "select", options: TASK_PRIORITIES, default: "Normal", required: true, list: true, filter: true },
      { name: "status", label: "Status", type: "select", options: TASK_STATUSES, default: "Open", required: true, list: true, filter: true },
      { ...owner, label: "Assigned to" },
      { name: "description", label: "Description", type: "textarea", full: true },
    ],
  },
  activities: {
    key: "activities", table: "activities", label: "Activities", singular: "Activity",
    ownerField: "owner_id",
    titleSql: (a) => `${a}.subject`,
    searchable: ["subject", "body"],
    defaultSort: "occurred_at", polymorphic: true,
    fields: [
      { name: "type", label: "Type", type: "select", options: ACTIVITY_TYPES, default: "Call", required: true, list: true, filter: true },
      { name: "subject", label: "Subject", type: "text", required: true, list: true },
      { name: "occurred_at", label: "When", type: "datetime", required: true, list: true },
      { name: "duration_min", label: "Duration (min)", type: "number" },
      { ...owner, label: "Logged by" },
      { name: "body", label: "Details", type: "textarea", full: true },
    ],
  },
  forms: {
    key: "forms", table: "web_forms", label: "Web Forms", singular: "Web Form",
    ownerField: null, managePerm: "forms.manage",
    titleSql: (a) => `${a}.name`,
    searchable: ["name", "slug", "title"],
    defaultSort: "name",
    related: [{ resource: "leads", fk: "web_form_id", label: "Submissions" }],
    fields: [
      { name: "name", label: "Internal name", type: "text", required: true, list: true },
      { name: "slug", label: "URL slug", type: "text", list: true, help: "Leave blank to generate from the name." },
      { name: "title", label: "Heading shown on the form", type: "text", full: true },
      { name: "fields", label: "Fields to collect", type: "multicheck", options: WEB_FORM_FIELDS, default: '["first_name","last_name","email"]', full: true },
      { name: "lead_source", label: "Lead source", type: "select", options: LEAD_SOURCES, default: "Web Form" },
      { ...owner, label: "Assign new leads to", filter: false },
      { name: "active", label: "Accepting submissions", type: "checkbox", default: 1, list: true },
      { name: "success_message", label: "Thank-you message", type: "textarea", full: true },
    ],
  },
  cases: {
    key: "cases", table: "cases", label: "Cases", singular: "Case",
    numberEntity: "cases", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `${a}.subject`,
    searchable: ["number", "subject", "lot_number"],
    defaultSort: "created_at", timeline: true,
    bulkFields: ["status", "priority"],
    fields: [
      { name: "subject", label: "Subject", type: "text", required: true, full: true },
      { name: "number", label: "Case #", type: "text", readOnly: true, list: true },
      { name: "type", label: "Type", type: "select", options: CASE_TYPES, default: "Service Request", required: true, list: true, filter: true },
      { name: "priority", label: "Priority", type: "select", options: CASE_PRIORITIES, default: "Medium", required: true, list: true, filter: true },
      { name: "status", label: "Status", type: "select", options: CASE_STATUSES, default: "New", required: true, list: true, filter: true },
      { name: "account_id", label: "Account", type: "ref", ref: "accounts", list: true },
      { name: "contact_id", label: "Contact", type: "ref", ref: "contacts", filterBy: "account_id" },
      { name: "deal_id", label: "Opportunity", type: "ref", ref: "opportunities", filterBy: "account_id" },
      { name: "product_id", label: "Product", type: "ref", ref: "catalogue" },
      { name: "lot_number", label: "Lot / batch", type: "text" },
      { name: "sla_due", label: "SLA target", type: "date", list: true },
      owner,
      { name: "description", label: "Description", type: "textarea", full: true },
      { name: "resolution", label: "Resolution", type: "textarea", full: true },
    ],
  },
  campaigns: {
    key: "campaigns", table: "campaigns", label: "Campaigns", singular: "Campaign",
    ownerField: "owner_id",
    titleSql: (a) => `${a}.name`,
    searchable: ["name", "description"],
    defaultSort: "start_date", timeline: true,
    bulkFields: ["status"],
    fields: [
      { name: "name", label: "Campaign name", type: "text", required: true, full: true },
      { name: "type", label: "Type", type: "select", options: CAMPAIGN_TYPES, default: "Outreach", required: true, list: true, filter: true },
      { name: "status", label: "Status", type: "select", options: CAMPAIGN_STATUSES, default: "Planned", required: true, list: true, filter: true },
      { name: "channel", label: "Channel", type: "select", options: CAMPAIGN_CHANNELS, list: true, filter: true },
      { name: "start_date", label: "Start", type: "date", list: true },
      { name: "end_date", label: "End", type: "date" },
      { name: "budget", label: "Budget", type: "money", list: true },
      { name: "actual_cost", label: "Spend", type: "money", list: true },
      { name: "expected_leads", label: "Expected leads", type: "number" },
      owner,
      { name: "description", label: "Description", type: "textarea", full: true },
    ],
  },
  approvals: {
    key: "approvals", table: "approvals", label: "Approvals", singular: "Approval",
    ownerField: null,
    titleSql: (a) => `${a}.policy`,
    searchable: ["policy", "comment"],
    defaultSort: "created_at", polymorphic: true,
    bulkFields: ["status"],
    fields: [
      { name: "policy", label: "Policy", type: "text", required: true, full: true },
      { name: "status", label: "Status", type: "select", options: APPROVAL_STATUSES, default: "Pending", required: true, list: true, filter: true },
      { name: "raised_by", label: "Raised by", type: "user", list: true },
      { name: "waiting_on", label: "Waiting on", type: "select", options: APPROVAL_ROLES, default: "Sales Manager", list: true },
      { name: "steps_done", label: "Steps done", type: "number", default: 0 },
      { name: "steps_total", label: "Steps total", type: "number", default: 1 },
      { name: "due_date", label: "Due", type: "date", list: true },
      { name: "decided_by", label: "Decided by", type: "user" },
      { name: "comment", label: "Comment", type: "textarea", full: true },
    ],
  },
  sourcing: {
    key: "sourcing", table: "sourcing_requests", label: "Sourcing", singular: "Sourcing request",
    numberEntity: "sourcing", numberField: "number", ownerField: "owner_id",
    titleSql: (a) => `COALESCE(${a}.number || ' · ', '') || ${a}.supplier`,
    searchable: ["number", "supplier", "notes"],
    defaultSort: "created_at",
    bulkFields: ["status"],
    fields: [
      { name: "number", label: "Request #", type: "text", readOnly: true },
      { name: "supplier_id", label: "Supplier", type: "ref", ref: "suppliers", required: true, list: true },
      { name: "deal_id", label: "Opportunity", type: "ref", ref: "opportunities", list: true },
      { name: "product_id", label: "Product", type: "ref", ref: "catalogue", list: true },
      { name: "quantity", label: "Quantity", type: "number", list: true },
      { name: "required_expiry", label: "Required expiry", type: "text", help: "Shown in the supplier inquiry email, e.g. 02/2028." },
      { name: "status", label: "Status", type: "select", options: SOURCING_STATUSES, default: "Draft", required: true, list: true, filter: true },
      { name: "offer_price", label: "Offer price (unit)", type: "money", list: true },
      { name: "lead_time_days", label: "Lead time (days)", type: "number" },
      { name: "reply_due", label: "Reply due", type: "date", list: true },
      owner,
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
  suppliers: {
    key: "suppliers", table: "suppliers", label: "Suppliers", singular: "Supplier",
    numberEntity: "suppliers", numberField: "number", ownerField: null,
    titleSql: (a) => `${a}.name`,
    searchable: ["number", "name", "contact_name", "email", "phone", "city", "country"],
    defaultSort: "name", importable: true,
    bulkFields: ["status", "category"],
    related: [
      { resource: "supplier-prices", fk: "supplier_id", label: "Product prices from this supplier" },
      { resource: "sourcing", fk: "supplier_id", label: "Sourcing requests" },
    ],
    fields: [
      { name: "number", label: "Supplier #", type: "text", readOnly: true },
      { name: "name", label: "Supplier name", type: "text", required: true },
      { name: "category", label: "Category", type: "select", options: SUPPLIER_CATEGORIES, list: true, filter: true },
      { name: "status", label: "Status", type: "select", options: SUPPLIER_STATUSES, default: "Active", required: true, list: true, filter: true },
      { name: "contact_name", label: "Contact person", type: "text", list: true },
      { name: "email", label: "Email", type: "email", list: true },
      { name: "phone", label: "Phone", type: "phone" },
      { name: "website", label: "Website", type: "url" },
      { name: "country", label: "Country", type: "country", list: true },
      { name: "state", label: "State / region", type: "state", countryField: "country" },
      { name: "city", label: "City", type: "text" },
      { name: "zip", label: "Zip / postal code", type: "text" },
      { name: "payment_terms", label: "Payment terms", type: "text" },
      { name: "lead_time_days", label: "Typical lead time (days)", type: "number" },
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
  documents: {
    key: "documents", table: "documents", label: "Documents", singular: "Document",
    ownerField: "owner_id",
    titleSql: (a) => `${a}.name`,
    searchable: ["name", "file_type"],
    defaultSort: "created_at",
    bulkFields: ["category", "access"],
    fields: [
      { name: "name", label: "Document", type: "text", required: true, full: true },
      { name: "category", label: "Category", type: "select", options: DOCUMENT_CATEGORIES, default: "Other", required: true, filter: true },
      { name: "file_type", label: "Type", type: "text", list: true, help: "e.g. PDF, DOCX, XLSX" },
      { name: "account_id", label: "Linked to", type: "ref", ref: "accounts", list: true },
      { name: "access", label: "Access", type: "select", options: DOCUMENT_ACCESS, default: "Team", required: true, list: true, filter: true },
      { name: "size_kb", label: "Size (KB)", type: "number", list: true },
      { name: "version", label: "Version", type: "number", default: 1 },
      { ...owner, label: "Uploaded by" },
      { name: "url", label: "Link to file", type: "url", full: true, help: "Where the file lives (SharePoint, Drive, …)." },
      { name: "description", label: "Notes", type: "textarea", full: true },
    ],
  },
  "price-books": {
    key: "price-books", table: "price_books", label: "Price books", singular: "Price book",
    ownerField: null, managePerm: "products.manage",
    titleSql: (a) => `${a}.name`,
    searchable: ["name", "region"],
    defaultSort: "name",
    related: [{ resource: "price-entries", fk: "price_book_id", label: "Product prices" }],
    fields: [
      { name: "name", label: "Name", type: "text", required: true, list: true },
      { name: "region", label: "Region", type: "text", list: true },
      { name: "currency", label: "Currency", type: "currency", list: true },
      { name: "segment", label: "Segment", type: "select", options: PRICE_SEGMENTS, default: "All customers", list: true },
      { name: "valid_from", label: "Valid from", type: "date", list: true },
      { name: "valid_to", label: "Valid to", type: "date" },
      { name: "active", label: "Published", type: "checkbox", default: 1, list: true },
    ],
  },
  "price-entries": {
    key: "price-entries", table: "price_entries", label: "Product prices", singular: "Product price",
    ownerField: null, managePerm: "products.manage",
    titleSql: (a) => `(SELECT p.name FROM products p WHERE p.id = ${a}.product_id) || ' · ' || (SELECT b.name FROM price_books b WHERE b.id = ${a}.price_book_id)`,
    searchable: ["product_id"],
    defaultSort: "created_at",
    fields: [
      { name: "price_book_id", label: "Price book", type: "ref", ref: "price-books", required: true, list: true },
      { name: "product_id", label: "Product", type: "ref", ref: "catalogue", required: true, list: true },
      { name: "min_qty", label: "From quantity", type: "number", default: 1, list: true },
      { name: "price", label: "Unit price", type: "money", required: true, list: true },
    ],
  },
  "supplier-prices": {
    key: "supplier-prices", table: "supplier_prices", label: "Supplier prices", singular: "Supplier price",
    ownerField: null,
    titleSql: (a) => `(SELECT p.name FROM products p WHERE p.id = ${a}.product_id) || ' · ' || (SELECT s.name FROM suppliers s WHERE s.id = ${a}.supplier_id)`,
    searchable: ["notes"],
    defaultSort: "created_at",
    fields: [
      { name: "product_id", label: "Product", type: "ref", ref: "catalogue", required: true, list: true },
      { name: "supplier_id", label: "Supplier", type: "ref", ref: "suppliers", required: true, list: true },
      { name: "price", label: "Supplier price (per unit)", type: "money", currencyField: "currency", required: true, list: true },
      { name: "currency", label: "Currency", type: "currency" },
      { name: "min_qty", label: "From quantity", type: "number", default: 1, list: true, help: "The price applies from this quantity up (the supplier's MOQ or a volume break)." },
      { name: "lead_time_days", label: "Lead time (days)", type: "number", list: true },
      { name: "valid_to", label: "Valid until", type: "date", list: true },
      { name: "notes", label: "Notes", type: "textarea", full: true, help: "e.g. incoterms, pack, where the price came from." },
    ],
  },
  contracts: {
    key: "contracts", table: "contracts", label: "Customer contracts", singular: "Customer contract",
    ownerField: null, managePerm: "products.manage",
    titleSql: (a) => `${a}.name`,
    searchable: ["name"],
    defaultSort: "created_at",
    fields: [
      { name: "name", label: "Contract", type: "text", required: true, list: true },
      { name: "account_id", label: "Account", type: "ref", ref: "accounts", required: true, list: true },
      { name: "product_id", label: "Product", type: "ref", ref: "catalogue", list: true },
      { name: "price", label: "Contracted price", type: "money", list: true },
      { name: "valid_from", label: "Valid from", type: "date", list: true },
      { name: "valid_to", label: "Valid to", type: "date", list: true },
    ],
  },
  "margin-floors": {
    key: "margin-floors", table: "margin_floors", label: "Margin floors", singular: "Margin floor",
    ownerField: null, managePerm: "products.manage",
    titleSql: (a) => `${a}.name`,
    searchable: ["name"],
    defaultSort: "min_margin_pct",
    fields: [
      { name: "name", label: "Rule", type: "text", required: true, list: true },
      { name: "segment", label: "Segment", type: "select", options: PRICE_SEGMENTS, default: "All customers", list: true },
      { name: "product_type", label: "Product type", type: "select", options: PRODUCT_TYPES, list: true },
      { name: "min_margin_pct", label: "Minimum margin", type: "percent", required: true, list: true },
    ],
  },
  migration: {
    key: "migration", table: "migration_runs", label: "Migration", singular: "Migration run",
    ownerField: null, managePerm: "admin",
    titleSql: (a) => `${a}.name`,
    searchable: ["name", "source_system"],
    defaultSort: "created_at",
    bulkFields: ["status"],
    fields: [
      { name: "name", label: "Run", type: "text", required: true, full: true },
      { name: "source_system", label: "Source system", type: "text", list: true },
      { name: "entity", label: "Entity", type: "select", options: MIGRATION_ENTITIES, required: true, list: true, filter: true },
      { name: "status", label: "Status", type: "select", options: MIGRATION_STATUSES, default: "Draft", required: true, list: true, filter: true },
      { name: "source_count", label: "Source rows", type: "number", list: true },
      { name: "loaded_count", label: "Loaded", type: "number", list: true },
      { name: "rejected_count", label: "Rejected", type: "number", list: true },
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
};

export const RELATABLE: ResourceKey[] = ["leads", "contacts", "accounts", "opportunities", "quotes", "cases", "campaigns"];

export function getResource(key: string): ResourceDef | null {
  return (RESOURCES as Record<string, ResourceDef>)[key] ?? null;
}

/** Plain, serialisable subset of a resource for client components. */
export function clientFields(def: ResourceDef) {
  return def.fields.map((f) => ({ ...f }));
}
