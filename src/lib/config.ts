export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "method365 CRM";
export const APP_VERSION = "v0.1.0";
/** Shown in a banner at the bottom of every page when set, e.g. "Demo environment". */
export const ENV_LABEL = process.env.NEXT_PUBLIC_ENV_LABEL ?? "Demo environment";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  SALES_MANAGER: "SALES_MANAGER",
  SALES_EXECUTIVE: "SALES_EXECUTIVE",
  MANAGEMENT: "MANAGEMENT",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  SALES_MANAGER: "Sales Manager",
  SALES_EXECUTIVE: "Sales Executive",
  MANAGEMENT: "Management",
};

/**
 * Permissions
 *  records.read.all  – see every record (otherwise only records you own)
 *  records.write     – create / edit records (executives: own records only)
 *  records.delete    – delete records
 *  records.assign    – change the owner of records
 *  bulk              – CSV import/export and bulk actions
 *  reports           – reports module
 *  forms.manage      – web forms module
 *  products.manage   – product catalogue
 *  admin             – users, security, numbering, currencies, audit log
 */
export type Permission =
  | "records.read.all"
  | "records.write"
  | "records.delete"
  | "records.assign"
  | "bulk"
  | "reports"
  | "forms.manage"
  | "products.manage"
  | "admin";

export const ROLE_PERMISSIONS: Record<Role, Permission[] | "*"> = {
  SUPER_ADMIN: "*",
  SALES_MANAGER: [
    "records.read.all",
    "records.write",
    "records.delete",
    "records.assign",
    "bulk",
    "reports",
    "forms.manage",
    "products.manage",
  ],
  SALES_EXECUTIVE: ["records.write"],
  MANAGEMENT: ["records.read.all", "reports"],
};

export function roleCan(role: Role, perm: Permission) {
  const p = ROLE_PERMISSIONS[role];
  return p === "*" || p.includes(perm);
}

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Proposal Sent", "Negotiation", "Won", "Lost", "Unqualified", "Converted"];
export const LEAD_SOURCES = ["Website", "Web Form", "Referral", "Cold Call", "Email Campaign", "Trade Show", "Partner", "Social Media", "Other"];
export const LEAD_RATINGS = ["Hot", "Warm", "Cold"];
export const DEAL_STAGES = ["Lead Generated", "Discovery", "Qualified", "Proposal Sent", "Negotiation", "Verbal Approval", "Won", "Lost"];
export const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== "Won" && s !== "Lost");
export const STAGE_PROBABILITY: Record<string, number> = {
  "Lead Generated": 5, Discovery: 10, Qualified: 25, "Proposal Sent": 50, Negotiation: 70, "Verbal Approval": 90, Won: 100, Lost: 0,
};
export const FORECAST_CATEGORIES = ["Pipeline", "Best Case", "Commit", "Omitted"];
export const INDUSTRIES = ["Pharmaceuticals", "Biotech", "Healthcare", "Medical Devices", "Wholesaler", "Distributor", "Retail", "Manufacturing", "Research", "Technology", "Other"];
export const ACCOUNT_TYPES = ["Prospect", "Customer", "Partner", "Churned", "Distributor", "Supplier", "Other"];
export const CONTACT_STATUSES = ["Active", "Archived"];

export const CASE_TYPES = ["Service Request", "Complaint", "Information Request", "Follow-Up", "Quality Issue", "Technical"];
export const CASE_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const CASE_STATUSES = ["New", "In Progress", "Awaiting Customer", "Awaiting Third Party", "Resolved", "Closed", "Cancelled"];
export const CAMPAIGN_TYPES = ["Conference", "Outreach", "Email Program", "Referral", "Webinar", "Paid Advertising", "Other"];
export const CAMPAIGN_STATUSES = ["Planned", "Active", "Paused", "Completed", "Cancelled"];
export const CAMPAIGN_CHANNELS = ["Email", "Phone", "SMS", "Post", "Event", "Online"];
export const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected", "Changes Requested", "Withdrawn", "Expired"];
export const APPROVAL_ROLES = ["Sales Manager", "Super Admin", "Management"];
export const SOURCING_STATUSES = ["Draft", "Sent", "Responded", "No Bid", "Declined", "Awarded", "Cancelled", "Expired"];
export const SUPPLIER_CATEGORIES = ["Manufacturer", "Distributor", "Wholesaler", "Logistics", "Service Provider", "Other"];
export const SUPPLIER_STATUSES = ["Active", "Approved", "Under Review", "On Hold", "Blocked"];
export const DOCUMENT_CATEGORIES = ["Proposal", "Contract", "Invoice", "Presentation", "Report", "Other"];
export const DOCUMENT_ACCESS = ["Private", "Team", "Public"];
export const PRODUCT_TYPES = ["Product", "Machine", "Service", "Packaging", "Logistics", "Ancillary"];
export const PRODUCT_STATUSES = ["Active", "Discontinued", "Superseded", "On Hold", "Pending Approval"];
export const MIGRATION_ENTITIES = ["account", "contact", "lead", "opportunity", "email", "activity", "quote", "document", "referenceData"];
export const MIGRATION_STATUSES = ["Draft", "Trial load", "Reconciled", "Approved by the business", "Cut over", "Abandoned"];
export const PRICE_SEGMENTS = ["All customers", "Hospital", "Distributor", "Wholesaler", "Retail", "Government"];
export const TASK_STATUSES = ["Open", "In Progress", "Done", "Cancelled"];
export const TASK_PRIORITIES = ["Low", "Normal", "High", "Urgent"];
export const ACTIVITY_TYPES = ["Call", "Email", "Meeting", "Note"];
export const QUOTE_STATUSES = ["Draft", "Submitted", "Approved", "Issued", "Pending Feedback", "Accepted", "Won", "Rejected", "Expired", "Withdrawn"];
export const WEB_FORM_FIELDS = ["first_name", "last_name", "email", "phone", "company", "title", "message"];
