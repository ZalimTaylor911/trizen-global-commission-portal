# Trizen Global — Freight Agent Commission & Finance Management System

Source spec as provided by the owner (Shabbir). This file is the authority for business rules.

---

## 1. Business Structure

Trizen works with freight brokerage agencies. Each agency splits the margin with the team.

Current agency: **GLT Logistics** — Agency 50% / Team 50%.

The team's share is distributed among five partners:

| Partner  | Share | Role   | Bears operational expenses |
| -------- | ----- | ------ | -------------------------- |
| Shabbir  | 25%   | Admin  | Yes                        |
| Abrar    | 25%   | Active | Yes                        |
| Muddasir | 25%   | Active | Yes                        |
| Muzammil | 20%   | Silent | No                         |
| Allah    | 5%    | Silent | No                         |

Shares total 100% and apply **only to the team's portion**, after the agency cut.

## 2. Multiple Agency Management

- Agencies are CRUD-managed by the Admin.
- Each agency defines its own `agentPercent` / `agencyPercent` split (must total 100).
- Agencies can be marked Active / Inactive.
- Shipments select an agency; its split applies automatically.

Examples: GLT 50/50, Agency B 60/40, Agency C 70/30.

## 3. Shipment Fields

Month, Date, Customer, Company Name, POC, Lane, AR, Carrier Name, AP,
Gross Margin, Net Margin, Load Number, Status, Transit Type (LTL / FTL),
Transit Days, Actual Pickup Date, Estimated Delivery Date, Actual Delivery Date,
Agency, Invoice Date, Notes.

Net Margin is **derived, not entered** — see §5.

**The Load Number is the invoice number.** The customer is billed under it, so
the portal carries no second invoice reference.

### Transit days (§21)

Estimated delivery is calculated from the pickup date and transit days, counted
according to the service type:

- **LTL** — business days only; Saturdays and Sundays don't tick.
  Picked up Monday with 3 days transit delivers Thursday.
- **FTL** — calendar days, weekends included.
  Picked up Friday with 3 days transit delivers Monday.

The calculated date is offered rather than forced, so a quoted date that differs
from the arithmetic can still be recorded.

No other shipment detail is required.

### Bulk import

Shipments can be loaded from a filled-in CSV or Excel template rather than
keyed in one at a time. The template carries Gross Margin but deliberately
**omits Net Margin**, so a figure typed into a spreadsheet can never disagree
with the agency split. Every row is validated before anything is written, and
rows with errors are reported and skipped rather than guessed at.

## 4. Status Workflow

`Assigned`, `In Transit`, `Delivered`, `Completed`, `Billed`, `Claim`,
`Dissolved`, `TONU`, `Customer Paid`, `Issue / Dispute`, `Agency Paid`.

**`Completed`** means delivery is done, the POD is already in the brokerage's
TMS, and the load is ready for the accounting team to invoice. The portal
uploads no documents and issues no invoices — this status exists to mirror the
operational workflow and to start the receivable clock (§14).

**`Billed`** means the accounting team has now actually invoiced the customer.
Where `Completed` says the load is *ready* to bill, `Billed` says it *has been*
billed. `Invoiced` is the same status said differently — the bulk importer
accepts either wording, and the portal stores it as `Billed`.

Because the status asserts an invoice exists, the **Invoice Date is required**
on a load marked `Billed`: it is the date the receivable is counted from. The
shipment form stamps today's date when the status is chosen and refuses to save
without one; the importer rejects the row.

**Rule:** commission is earned **only** when status becomes `Agency Paid`.
Before that, a shipment must not affect commissions, balances, or financial reports.

## 5. Margins and Commission Distribution

**Gross Margin is the whole margin on a load** (AR − AP) — our share and the
agency's share together. The agency split applies to *that*, and the result is
the **Net Margin: our share**.

```
grossMargin  = AR − AP                       (entered)
netMargin    = grossMargin × agentPercent    (derived — never typed in)
agencyKeeps  = grossMargin − netMargin
```

Owner's worked example: Gross Margin $700 with a 50/50 agency → Net Margin $350.
At 60/40 the same $700 gross gives us $420.

Net Margin **is** the team commission, and it is what the partners divide:

```
partnerEarning[p] = netMargin × sharePercent[p]
```

Example: gross $2,000 at 50/50 → net $1,000 → Shabbir $250, Abrar $250,
Muddasir $250, Muzammil $200, Allah $50.

The agency's cut is stored implicitly, by subtraction, rather than by
re-applying the percentage at read time. This means an agency that later changes
its split does not retroactively rewrite the history of loads already paid.

## 6. Expense Management

Categories are Admin-managed (phone, internet, rent, software, inventory,
marketing, misc). Expenses have amount, date, category, notes.

### Type 1 — Operational Expense
Split **equally among partners who bear operational expenses** (Shabbir,
Abrar, Muddasir). Silent partners are charged $0.
Example: $300 → $100 each for the three active partners.

### Type 2 — Agency Deduction
Agency clawbacks (claim deduction, billing adjustment, commission correction).
Deducted from the team's total before partner balances are calculated, so every
active partner carries the deduction in proportion to their commission share.
Silent partners are included according to their share.
Example: $100 is split $25 / $25 / $25 / $20 / $5 for the current 25/25/25/20/5 split.

## 7. Withdrawal Management

Only the Admin records withdrawals. Fields: Partner, Amount, Date, Notes.
A withdrawal immediately reduces that partner's balance and the total
outstanding balance. Nothing is recalculated by hand.

## 8. Dashboard

**Financial summary:** Revenue (AR), Carrier Cost (AP), Total Gross Margin,
Gross Margin %, Agency Keeps, Net Margin (ours), Average Net per Load,
Total Expenses, Total Withdrawals, Total Outstanding Balance, Pipeline.

**Charts:** revenue vs gross vs net margin by month; net margin against expenses
and withdrawals by month; loads by status; LTL vs FTL mix.

**Rankings:** top customers, lanes and carriers by net margin.

**Partner cards:** Total Earned, Expenses Deducted, Agency Deductions,
Withdrawals, Current Balance.

**Monthly summary:** Loads Moved, Gross Margin, Net Margin, Expenses,
Withdrawals, Remaining Balance.

**Agency summary:** Total Loads, Gross Margin, Net Margin, Agency Earnings,
Team Earnings.

## 9. Reports

Filter by Month, Year, Agency, Customer, Partner, Status, Shipment Type,
Carrier and Lane. Export to Excel and PDF.

## 10. User Roles (superseded by §25)

**Admin (Shabbir)** — unrestricted.

**User** (stored as role `partner`) — runs the day-to-day business: creates and
edits customers, shipments and expenses; sees every partner's withdrawals and
balances, with nothing hidden between partners. Cannot record withdrawals,
change partner shares or agency splits, manage accounts, or delete financial
records.

## 13. Customer Management (CRM)

Customers carry company name, primary contact, phone, email, billing and
shipping addresses, notes, payment terms, optional credit limit, optional tax ID
and an active flag.

**Agency assignment.** A customer may be assigned one or more brokerages. When a
load is booked for them, the agency dropdown narrows to that list. No assignment
means any agency is allowed.

## 14. Receivable Tracking

**The portal never creates or sends invoices.** The brokerage's TMS and the
accounting team do that. What the portal tracks is the receivable each invoice
implies, derived from the shipment's status and the customer's payment terms:

```
invoiceDate = the recorded TMS invoice date, or the load date if blank
dueDate     = invoiceDate + customer.paymentTermsDays
overdue     = dueDate has passed and the customer has not paid
```

Example: invoiced 1 July on Net 15 is due 16 July.

A load raises a receivable once it reaches `Completed`, stays outstanding
through `Billed`, and the receivable closes at `Customer Paid` or `Agency Paid`.
`Issue / Dispute` stays outstanding. `Dissolved`, `Claim` and `TONU` are written
off and never chased.

The TMS invoice number can be recorded against a load for cross-reference.

**Dashboard:** Total Outstanding AR, Due Today, Due This Week, Overdue, Total
Overdue Amount, Average Days Outstanding, ageing buckets, and customers ranked
by what they owe. Overdue invoices raise an alert automatically.

## 15. CRM Sidebar

Dashboard, Create Customer, Customer List, Outstanding Invoices, Due Soon
Invoices, Overdue Invoices, Customer Reports. The overdue count shows as a badge.

## 16. Customer Profile

Each customer has a page showing contact details, assigned agencies, terms and
status; shipment counts (total, this month, active, completed, cancelled);
revenue (AR, AP, gross margin, net margin, outstanding AR, paid AR, average
margin per load); invoicing (total, paid, outstanding, overdue, average payment
days); their open invoices; and their load history.

## 11. Audit Log

Log every significant action with User, Action, Date & Time, Previous Value,
New Value. Covers shipment create/update/status change, expense added,
withdrawal recorded, agency edited, partner updated.

## 12. Derived Balance Formula

```
partnerBalance = totalEarned
               - operationalExpenseShare
               - agencyDeductionShare
               - withdrawals

totalOutstandingBalance = Σ partnerBalance
```

Only `Agency Paid` shipments contribute to `totalEarned`.

**Shares are frozen when a load is earned.** The moment a shipment reaches
`Agency Paid` it records the partner percentages in force at that moment, and
its commission is divided by those from then on. Editing a partner's share
therefore changes what they earn on future loads without re-spreading money
already earned — and possibly already drawn — behind their back. This mirrors
how the agency split is fixed per shipment at entry (§5).

Loads not yet earned follow the live shares, so the pending balance always
reflects what a partner would receive today.

---

## Open questions (assumptions currently in effect)

1. **Total Available Balance vs Total Outstanding Balance.** Section 7's example
   defines Outstanding as the sum of partner balances. Under the formula above,
   "Available" computes to the same number. Currently implemented as: Outstanding
   = sum of partner balances; and a separate **Pipeline** figure shows the net
   margin on shipments not yet `Agency Paid`. Needs owner confirmation.
### Resolved

- **Gross vs Net Margin** (2026-07-31). Gross is the whole margin; the agency
  split applies to it; Net is our resulting share and is derived, never typed.
  See §5.

- **Partner share changes** (2026-08-03). Shares are now frozen onto a shipment
  when it reaches `Agency Paid`, so changing a percentage affects future loads
  only and never rewrites balances already earned. Loads created before this
  rule existed carry no stamp and continue to follow the live shares. See §12.

- **TONU** (2026-08-03). Treated as written off throughout, matching §14: it
  raises no receivable, and its margin is excluded from the pipeline and from
  pending partner balances. Previously the receivable side wrote it off while
  the commission side still counted it as money coming. If Trizen does bill a
  TONU fee that it expects to collect, this is the decision to revisit.
