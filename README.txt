# Bug Fixes - Where to Upload Each File

## HOW TO USE
Each file in this zip mirrors the exact folder path inside your project.
Just copy each file to the matching path in your project root.

---

## FILES & WHERE THEY GO

### 🔴 BUG FIX: Duplicate Notifications
**File:** `src/utils/notifications.ts`
**Upload to:** `your-project/src/utils/notifications.ts`
**What was fixed:**
- `checkAndCreateFollowUpNotifications` had NO duplicate check — was creating
  a new notification every 10 minutes for every user. Now checks created_at >= today.
- `checkAndCreateLowStockNotifications` and `checkAndCreateExpiryNotifications`
  were checking `is_read = false` — so every time you read a notif, a new one
  was created next interval. Now also checks created_at >= today (once per day max).

---

### 🔴 BUG FIX: Purchase Invoice stuck as "partial" when balance = 0
**File:** `src/components/finance/PurchaseInvoiceManager.tsx`
**Upload to:** `your-project/src/components/finance/PurchaseInvoiceManager.tsx`
**What was fixed:**
- `fixStaleStatuses` was looping record-by-record (slow). Now uses single bulk UPDATE.
- `fixStaleStatuses` is now also called after every invoice edit/save, so discounts
  applied later will immediately recalculate the status.

### 🗄️ DATABASE MIGRATION (run this in Supabase)
**File:** `supabase/migrations/20260411114529_fix_stale_purchase_invoice_statuses.sql`
**How to run:**
  Option A — Supabase Dashboard → SQL Editor → paste & run
  Option B — Upload to `your-project/supabase/migrations/` and run `supabase db push`
**What it does:** One-time fix for ALL existing invoices in DB that are stuck
  as "partial" with balance = 0. Safe to run multiple times (idempotent).

---

### 🟡 BUG FIX: Crash when company_name / full_name is null (6 files)
**Files:**
- `src/components/crm/CustomerDatabase.tsx`     → your-project/src/components/crm/
- `src/components/crm/ArchiveView.tsx`          → your-project/src/components/crm/
- `src/components/settings/SuppliersManager.tsx`→ your-project/src/components/settings/
- `src/components/tasks/TaskFormModal.tsx`      → your-project/src/components/tasks/
- `src/components/tasks/TaskDetailModal.tsx`    → your-project/src/components/tasks/
- `src/pages/SalesTeam.tsx`                    → your-project/src/pages/

**What was fixed:** `.toLowerCase()` called on potentially null fields.
  Changed to `?.toLowerCase()` so it returns undefined instead of crashing.

---

## SUMMARY TABLE

| # | File | Bug Fixed |
|---|------|-----------|
| 1 | src/utils/notifications.ts | Duplicate notifications every 10 min |
| 2 | src/components/finance/PurchaseInvoiceManager.tsx | Invoice stuck as "partial" when balance=0 |
| 3 | supabase/migrations/...fix_stale...sql | DB: fix all existing stale records |
| 4 | src/components/crm/CustomerDatabase.tsx | Null crash on search |
| 5 | src/components/crm/ArchiveView.tsx | Null crash on search |
| 6 | src/components/settings/SuppliersManager.tsx | Null crash on search |
| 7 | src/components/tasks/TaskFormModal.tsx | Null crash on user search |
| 8 | src/components/tasks/TaskDetailModal.tsx | Null crash on mention search |
| 9 | src/pages/SalesTeam.tsx | Null crash on customer search |
