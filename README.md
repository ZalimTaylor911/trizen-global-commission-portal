# Trizen Commission Portal

Windows desktop app for managing freight brokerage commissions, partner
balances, expenses and withdrawals. React + TypeScript in an Electron shell,
with Firebase Firestore as the live shared database.

The business rules this implements are written down in [SPEC.md](SPEC.md) — that
file is the authority, and the calculation engine is unit tested directly
against its worked examples.

---

## What you need before it will run

1. **Node.js 20 or newer** — <https://nodejs.org>
2. **A Firebase project on the free Spark plan** — see below.

That's it. There is no separate backend server to host or keep running.

---

## Firebase setup (one time)

1. Create a project at <https://console.firebase.google.com>. The **Spark (free)
   plan** is sufficient: three users generate a tiny fraction of its 50,000
   daily reads and 20,000 daily writes.
2. **Build → Authentication → Sign-in method**: enable **Email/Password**.
3. **Build → Authentication → Users**: add one user per person who needs access.
   Note each one's **User UID** — you'll need it in step 7.
4. **Build → Firestore Database**: create a database in **production mode**.
5. **Project settings → General → Your apps**: register a **Web app** and copy
   the config values.
6. Copy `.env.example` to `.env` and paste the values in.
7. Publish the access rules (see [Security](#security) — without this, any
   signed-in user can rewrite the books):

   ```bash
   npx firebase-tools deploy --only firestore:rules,firestore:indexes
   ```

8. Start the app, sign in as yourself, then open **Partners** → *Create the five
   partners on file* → use the 🔑 button on each row to paste that person's
   Firebase User UID. That link is what gives them their role.

---

## Running it

```bash
npm install
```

Development, with the Electron window:

```bash
npm run dev
```

Development in a plain browser (no Electron window):

```bash
npm run dev:web
```

Unit tests for the commission engine:

```bash
npm test
```

Build a Windows installer into `release/`:

```bash
npm run dist:win
```

---

## How the money works

The engine lives in [`src/domain/engine.ts`](src/domain/engine.ts) and is pure —
no Firebase, no React. Everything on the dashboard and in the reports is derived
from it, so there is one place where the rules live.

**Commission is earned only when a shipment's status reaches `Agency Paid`.**
Before that it shows as *pipeline* and touches nobody's balance.

**Gross Margin is the whole margin on a load** — ours and the agency's together.
The split applies to that, and what's left for us is the **Net Margin**:

```
gross margin = AR − AP                    (you enter this)
net margin   = gross margin × team %      (calculated, not typed)
agency keeps = gross margin − net margin
```

A $700 gross margin on a 50/50 agency leaves $350 as net margin. On a 60/40
agency the same load leaves $420.

Net margin **is** the team commission, and it's what the partners divide:

```
each partner = net margin × their share %
```

So $700 gross at 50/50 → $350 ours → Shabbir $87.50, Abrar $87.50,
Muddasir $87.50, Muzammil $70, Allah $17.50.

Net margin is stored on the shipment when it's saved, and the agency's cut is
derived by subtraction. That way an agency that renegotiates its split later
doesn't rewrite the history of loads it already paid.

Expenses come in two kinds:

| Kind             | Charged to                                    |
| ---------------- | --------------------------------------------- |
| Operational      | Only partners flagged as sharing costs         |
| Agency deduction | All active partners, split by commission share |

And a partner's balance is:

```
balance = earned − operational share − deduction share − withdrawals
```

Every split runs through `allocate()` in
[`src/domain/money.ts`](src/domain/money.ts), which divides in integer cents and
hands out any leftover cent by the largest-remainder method. A $100 expense
shared three ways comes back as 33.34 / 33.33 / 33.33 — never $99.99.

---

## Brand and theming

| | |
| --- | --- |
| Navy | `#0D1B3D` — sidebar, headings, dark surfaces |
| Green | `#059669` — primary actions, active state, accents |
| Grey | `#A6A8AB` — muted text |
| Type | Montserrat, bundled locally via `@fontsource` |

### The logo

The real artwork lives in `src/assets/brand/` and is imported by
[`src/components/Logo.tsx`](src/components/Logo.tsx) — the only module any screen
reads a logo from. To change one, replace the file; nothing else needs touching.

| File | Used for |
| --- | --- |
| `icon-only.png` | Sidebar and collapsed rail |
| `primary_full_color_logo.png` | Login header — the lockup with the tagline |
| `stacked_layout.png` | Login panel |
| `favicon_appicon.png` | Browser tab icon |

**All four are navy artwork on a transparent background**, so they need a light
ground. Where one sits on a dark surface — the navy sidebar, the login panel —
it's placed on a white `.logo-plaque` tile. Dropping them straight onto navy
would make the "T" and "TRIZEN" almost invisible.

If you ever supply light-on-dark versions, the plaques can come off.

### The login illustration

Save the artwork as **`src/assets/brand/login-art.png`** (`.jpg`, `.webp` and
`.svg` also work) and it fills the right-hand panel edge to edge. Nothing else
needs changing — [`LoginArt.tsx`](src/components/LoginArt.tsx) picks it up at
build time.

It's drawn with `object-fit: cover` and centred, so it fills any window size
without distorting; a **portrait or square image crops best**, since the panel is
taller than it is wide. A soft dark gradient covers the lower third so the
headline stays readable over it.

Without that file, the panel falls back to a plain brand gradient with the mark
centred.

**Light and dark** are switched from the bottom of the sidebar and remembered per
machine; first run follows your Windows setting. Every colour is a CSS variable
keyed off `data-theme` on `<html>`, so both palettes stay consistent — including
chart axes, grids and series, which read from the theme rather than fixed hexes.

---

## Getting around

The sidebar runs the full height of the window; the workspace beside it is an
inset rounded panel, so the app reads as one surface rather than a page under a
toolbar. The header carries breadcrumbs, search, a **New** menu, the alerts bell
and your avatar — all sitting on the page itself, with no white band.

**Click the logo** at the top of the sidebar to collapse it to an icon rail and
again to expand — there is no separate burger button. The choice is remembered
per machine. Whichever screen you're on is filled in brand green with a white
accent bar down its left edge, so it stays obvious in both the expanded menu and
the collapsed rail.

**Ctrl+K** opens search from anywhere — it looks across load numbers, customers,
lanes and carriers, and arrow keys plus Enter jump straight to a record.

The bell shows everything that needs attention, derived live rather than stored:
overdue invoices, invoices due today or this week, delivered loads still waiting
on a POD, loads awaiting agency payment, open claims and disputes, customers over
their credit limit, partners in the red, and loads with no customer linked. The
same list appears as clickable cards at the top of the dashboard.

---

## Transit and delivery dates

Estimated delivery is worked out from the pickup date and transit days, counted
the way each service actually runs:

- **LTL** rides the carrier's weekday network, so transit is **business days** —
  picked up Friday with 3 days transit delivers the following **Wednesday**.
- **FTL** is a dedicated truck that keeps rolling, so transit is **calendar
  days** — the same booking delivers **Monday**.

The portal calculates the date and offers it; you can override it if the carrier
quoted something different. Once an actual delivery date is entered, the load is
flagged early, on time or late against the estimate.

---

## CRM and receivables

**The portal never creates or sends an invoice.** Your TMS and accounting team
do that. What it tracks is what each invoice is *owed against*, worked out from
the shipment's status and the customer's payment terms:

```
invoice date = the invoice date you record, or the load date if blank
due date     = invoice date + the customer's terms
overdue      = past due and the customer still hasn't paid
```

**The load number is the invoice number** — it's what the customer is billed
under, so there's no separate field to keep in sync.

A load starts a receivable when you mark it **Completed** — delivered, POD in the
TMS, ready for accounting to bill. Mark it **Billed** once accounting has
actually sent the invoice; that step needs the invoice date, because the due
date is counted from it. (Type **Invoiced** in an import sheet if that's your
wording — it means the same thing.) The receivable closes at **Customer Paid**.
A load in **Issue / Dispute** stays outstanding; **Dissolved**, **Claim** and
**TONU** are written off and never chased.

The CRM is three screens:

- **Dashboard** — outstanding AR, due today and this week, overdue, average days
  outstanding, an ageing chart, and who owes the most.
- **Customers** — the list with full create/edit/delete, plus a summary export.
  Each customer has a profile page with their shipment, revenue and invoicing
  statistics alongside their open invoices and load history.
- **Invoices** — one screen with **Outstanding / Due soon / Overdue / Paid**
  tabs. Filter to a single customer and the export becomes that customer's
  statement; leave it on all customers and you get an AR ageing report.

Assigning agencies to a customer narrows the agency dropdown when you book their
loads, so a customer restricted to one brokerage can't be booked under another
by accident.

---

## Your profile and admin settings

The avatar menu in the top-right opens **My profile** — name, phone, picture,
email and password. Pictures are cropped square, scaled to 128px and stored on
your user record, which keeps them free; Cloud Storage would require billing.
Changing your email sends a confirmation link to the new address, so a typo
can't lock you out. Changing your password asks for the current one first.

Admins also get **Settings**:

- **Users and roles** — assign administrator or user, and link each login to a
  partner. Creating the login account itself still happens in the Firebase
  console; that needs a server-side key the free plan doesn't provide.
- **System preferences** — company name, default payment terms for new
  customers, low-margin warning threshold.
- **Alerts** — switch individual alert types on or off. In-app only; email and
  SMS need a server.
- **Backup** — downloads every record as one JSON file. Restoring is deliberately
  not automatic, because writing a backup over a live database would silently
  discard everything since.

A user can edit their own profile but **cannot change their own role or which
partner they're linked to** — that's enforced in the security rules, not just
hidden in the UI, so nobody can grant themselves admin or point their login at
someone else's earnings.

---

## Making the shipment table your own

**Columns** on the Shipments screen opens your personal layout:

- Show or hide any column. Six extras — transit days, pickup, estimated and
  actual delivery, invoice date and notes — start hidden so the table stays
  readable; turn on whichever you use.
- Drag rows in the panel to reorder columns.
- Pin a column to freeze it at the left while you scroll sideways.
- Drag a column's right edge in the table itself to resize it.
- Click a header to sort; clicking again reverses, a third time clears it.
- Save named layouts and switch between them — an operations view and a billing
  view, say.

**Excel** and **PDF** on that screen export exactly the columns you can see, in
their current order and sort, honouring the filters. That's separate from the
Reports screen, which exports fixed report shapes.

Settings are yours alone and stored on your own machine, so changing them
doesn't affect what anyone else sees. Adding a column in a future release won't
disturb a saved layout — it simply appears at the end.

---

## Bulk import

**Shipments → Import** takes a CSV or Excel file rather than one-at-a-time entry.

1. Download the template. The Excel one has dropdowns for agency, status and
   type, plus a reference sheet listing every valid value.
2. Paste your loads under its headings.
3. **Drag the file onto the drop zone**, or click to browse for it. Every row is
   checked and you get a preview — how many are ready, which have problems, and
   what the totals come to — *before* anything is written.

The template has no Net Margin column on purpose. It's always calculated from
Gross Margin and the row's agency, so a stale figure in a spreadsheet can't
corrupt anybody's balance.

Rows with errors are listed with the reason and skipped; the rest still import.
Load numbers that already exist are flagged as warnings rather than blocked, so
you can decide. An import writes one audit entry recording the file, the count
and the load numbers — not hundreds of individual entries.

---

## Roles

| | Admin | User |
| --- | --- | --- |
| Customers, shipments, expenses | Full CRUD | Create and edit |
| Delete any financial record | Yes | No |
| Agencies, partners, commission splits | Full CRUD | Read only |
| Withdrawals | Record and delete | See everyone's, record none |
| Dashboard, CRM, reports | Everything | Everything |
| Audit log, user management | Yes | No |

Nothing is hidden between partners — every user sees every partner's earnings,
withdrawals and balances.

A person's role comes from their `users/{uid}` document, which only an admin can
write — nobody can promote themselves.

---

## Security

[`firestore.rules`](firestore.rules) is the only thing enforcing access. The
Spark plan has no Cloud Functions, so there is no server-side code to fall back
on: **if the rules aren't deployed, they aren't in effect.**

The rules enforce the role matrix above: users can create and update customers,
shipments and expenses, but cannot manage agencies, partners, accounts or
withdrawals, and cannot delete financial records. Everyone can see the team's
withdrawals and balances. The audit log is append-only; every application write
is committed in the same Firestore batch as its audit entry, which uses Firebase
server time and is bound to the signed-in user's profile. Entries cannot be
edited or deleted by anyone, admins included.

The values in `.env` are not secrets. A Firebase web config is designed to ship
inside a client app; the rules are what protect the data.

---

## Layout

```
electron/          Electron main process and preload bridge
src/
  domain/          types, money helpers, commission engine (+ tests)
  firebase/        config, typed collections, audited write path
  context/         auth state and live Firestore subscriptions
  components/      layout shell and shared UI pieces
  pages/           one file per screen
  lib/             dates, report builders, Excel/PDF export
firestore.rules    access control — deploy this
SPEC.md            the business rules
```

Every write goes through [`src/firebase/repository.ts`](src/firebase/repository.ts)
rather than calling Firestore directly. That is what guarantees each change
lands in the audit log with its before and after values.

---

## Notes

- **Offline**: Firestore's persistent cache is enabled, so the app opens with
  last-known figures and keeps working through a dropped connection, then
  reconciles when it returns.
- **Live updates**: a shipment marked `Agency Paid` on one machine repaints the
  other two dashboards without a refresh.
- **Exports** are generated in the app and saved through a native Windows save
  dialog. No Python or Office install is required.
