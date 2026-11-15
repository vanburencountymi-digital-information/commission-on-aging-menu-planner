# COA Menu Planner — Testing Guide

**Version:** 1.1 | **Date:** May 2026  
**Application:** St. Joseph County Commission on Aging — Menu Planner  
**Purpose:** Pre-deployment and post-deployment verification checklist

---

## How to Use This Guide

- Work through each section in order for a full regression test.
- Each test case lists **Steps** and **Expected Result**.
- Mark each row ✅ Pass, ❌ Fail, or ⏭ Skip (with reason).
- For AI-powered features, you need a valid `ANTHROPIC_API_KEY` configured in the environment.
- For production testing, use test accounts — never modify real menu data with fake records.

---

## Test Accounts

| Role | Email | Notes |
|------|-------|-------|
| ADMIN | admin@coa.example | Full access + user management |
| NUTRITION_MANAGER | nm@coa.example | Menu create/edit, AI features |
| DIETITIAN | rd@coa.example | RD approval queue |
| KITCHEN_STAFF | kitchen@coa.example | Read-only kitchen view only |

> **Note:** Ask your ADMIN to create these accounts using the User Management page before running tests.

---

## 1. Authentication & Session Management

### 1.1 Login
| # | Steps | Expected Result |
|---|-------|-----------------|
| 1.1.1 | Go to `/login`. Enter a **valid** email and password. Click **Sign In**. | Redirected to `/` (Menu Calendar). User name appears in sidebar. |
| 1.1.2 | Go to `/login`. Enter an **invalid** password. Click **Sign In**. | Error message: "Invalid email or password." Still on `/login`. |
| 1.1.3 | Go to `/login`. Submit an **empty** form. | Form validation error. |
| 1.1.4 | After successful login, close and reopen the browser tab. Navigate to `/`. | Still logged in — session persists. |

### 1.2 Logout
| # | Steps | Expected Result |
|---|-------|-----------------|
| 1.2.1 | Click the **Logout** button in the sidebar. | Redirected to `/login`. |
| 1.2.2 | After logout, attempt to navigate to `/menus`. | Redirected to `/login`. |

### 1.3 Role-Based Access
| # | Steps | Expected Result |
|---|-------|-----------------|
| 1.3.1 | Log in as **KITCHEN_STAFF**. | Lands on `/kitchen`. Only "Kitchen View" appears in sidebar. No access to menu planning routes. |
| 1.3.2 | As KITCHEN_STAFF, manually navigate to `/menus`. | Redirected to `/kitchen`. |
| 1.3.3 | Log in as **DIETITIAN**. | Sees Menu Calendar, RD Review Queue. No "Create Menu" or Edit buttons. |
| 1.3.4 | Log in as **NUTRITION_MANAGER**. | Full planning access — Create Menu, Generate Menu, Edit items. No Admin section in sidebar. |
| 1.3.5 | Log in as **ADMIN**. | Full access including "Admin" section (User Management) in sidebar. |

---

## 2. Recipe Management

### 2.1 Create Recipe Manually
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.1.1 | As NM/ADMIN, go to **Recipes** → click **New Recipe**. | Recipe Editor opens with blank form. |
| 2.1.2 | Fill in Name, Category (HOT_ENTREE), Base Servings (100). Leave other fields blank. Click **Save Recipe**. | Recipe saved and navigated to Recipe Detail page. |
| 2.1.3 | Try to save without a Name. | Validation error: "Required". Form not submitted. |
| 2.1.4 | Create a recipe with Protein Group = CHICKEN and Seasons = FALL, WINTER. Click Save. | Recipe detail shows correct protein group and seasons. |

### 2.2 Add Ingredients
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.2.1 | Edit a recipe. Add an ingredient: name "Chicken Breast", qty 20, unit "lb". Click **Save Recipe**. | Ingredient appears in recipe detail. |
| 2.2.2 | Add multiple ingredients. Add a duplicate ingredient name with a different unit. Click Save. | Both rows saved — no duplicate prevention at this level. |
| 2.2.3 | Add ingredient. Set Vendor to "GFS", enter a Product Code "12345", Case Size "6×5 lb". Save. | Vendor fields saved (verify in the Order List when menu is published). |
| 2.2.4 | Set Vendor to "" (Untagged) for one ingredient. Save. | Ingredient appears in "Untagged" section of Order List (amber warning). |

### 2.3 USDA Nutrition Linking
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.3.1 | In Recipe Editor, click **USDA** button next to an ingredient. Type "chicken breast" in search. | USDA search modal opens. Results appear within 2 seconds. |
| 2.3.2 | Click a search result to select it. | Modal closes. Ingredient shows FDC ID badge in green. |
| 2.3.3 | Click **Auto-link USDA** button. | All unlinked ingredients attempt AI-assisted auto-link. Toast shows "Linked N ingredients (X via AI)". Ingredients linked by AI show a ✨ sparkle icon on their FDC badge. |
| 2.3.4 | Hover over the ✨ sparkle badge on an AI-linked ingredient. | Tooltip shows AI reasoning and FDC description (e.g. "Best match for chicken breast in a HOT_ENTREE recipe"). |
| 2.3.5 | On Recipe Detail, click **Recalc Nutrition**. | Button shows "Calculating…" then "Done ✓". Nutrition data appears if USDA IDs were set. |
| 2.3.6 | Test Auto-link with no `ANTHROPIC_API_KEY` set. | Auto-link still completes — falls back to top USDA search result. No crash. No sparkle badge shown. |

### 2.4 AI Recipe Wizard
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.4.1 | Go to Recipes → click **Create with AI**. | AI Recipe Wizard modal opens with description field and example chips. |
| 2.4.2 | Click an example chip (e.g. "BBQ Chicken"). | Chip text populates the description field. |
| 2.4.3 | Type a description, select Category, click **Generate Recipe**. | Loading animation ("Generating…"). After ~15 seconds, Preview step shows generated recipe fields and ingredients. |
| 2.4.4 | In Preview, edit the recipe name and a quantity. Click **Save Recipe**. | Navigated to Recipe Detail. Recipe shows "AI" badge in recipe list. `is_active = false` (inactive badge visible if admin). |
| 2.4.5 | In Preview, click **Try Again** instead of Save. | Returns to Describe step with the same description pre-filled. |
| 2.4.6 | Test with no `ANTHROPIC_API_KEY` set in environment. | Error state: "AI service unavailable — ANTHROPIC_API_KEY not configured." No crash. |

### 2.5 Recipe Import Wizard
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.5.1 | As NM/ADMIN, go to **Recipes** → click **Import Recipe** (indigo button). | ImportRecipeWizard modal opens with a large text area. |
| 2.5.2 | Paste in raw recipe text (ingredient list + instructions). Enter a Source Name (e.g. "ICN"). Select a Category Hint. Click **Parse with AI**. | Loading step appears ("Parsing…"). After ~15 seconds, Preview step shows parsed name, servings, ingredient table, and instructions. |
| 2.5.3 | Verify the amber warning banner in Preview: "Awaiting RD Review before use." | Banner present. |
| 2.5.4 | Edit the parsed recipe name and a quantity in Preview. Click **Save**. | Saved. Recipe Detail opens. Recipe has `is_active = false`. Source shows "Imported: ICN". |
| 2.5.5 | In Recipe List, verify the "Awaiting RD Review" section shows the newly imported recipe with an "Imported" badge. | Collapsible section visible. Collapse/expand works. |
| 2.5.6 | As DIETITIAN/ADMIN, open the imported recipe detail. Click **Approve for Use**. | `is_active` becomes `true`. Amber banner and Approve button disappear. Recipe visible in normal recipe list. |
| 2.5.7 | Click **Re-parse** button in Preview (instead of Save). | Returns to the Paste step with original text preserved. |
| 2.5.8 | Test Import with no `ANTHROPIC_API_KEY` set. | Parse fails with inline error. No crash. |

### 2.6 Recipe Card PDF
| # | Steps | Expected Result |
|---|-------|-----------------|
| 2.6.1 | On Recipe Detail, click **Print Recipe Card**. | PDF downloads named `recipe-<id>.pdf`. Opens in PDF viewer with recipe name, ingredients, instructions. |
| 2.6.2 | Verify PDF includes production info table (servings, utensil, temps). | All non-empty fields appear in the info table. |
| 2.6.3 | Create a recipe with CCP in an instruction step. Export PDF. | That instruction step is bold in the PDF. |

---

## 3. Menu Planning

### 3.1 Create Monthly Menu
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.1.1 | As NM/ADMIN, navigate to Menu Calendar. Select a month with no menu. | "No menu for this month" empty state with "Create Menu" button visible. |
| 3.1.2 | Click **Create Menu**. | Menu created (DRAFT status badge appears). Calendar populates with all weekday cells for that month. |
| 3.1.3 | Try creating a menu for a month that already has one. | Button should not appear for existing menus. (If somehow reached via API: 409 error.) |
| 3.1.4 | Navigate back/forward months with ← → arrows. | Year/month update correctly. Calendar re-fetches. |

### 3.2 Add Items to Days
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.2.1 | Click a calendar day (DRAFT menu). | DayEditor panel opens on the right with the service date shown. |
| 3.2.2 | In DayEditor, type in the recipe search box. | Results appear after 1+ character typed. All recipes appear when field is focused (empty). |
| 3.2.3 | Select a recipe. Choose meal type "HOT". Click **Add**. | Item appears in the DayEditor item list. Calendar cell updates to show the recipe name. |
| 3.2.4 | Add a COLD, FROZEN, SIDE, FRUIT, BREAD, and DESSERT item to the same day. | All 7 meal types represented in the DayEditor with correct section headers and color coding. |
| 3.2.4a | In the **Frozen Option** slot, search for a recipe of any category (e.g. a HOT_ENTREE). | The Frozen Option slot accepts any recipe regardless of category — it is not filtered. |
| 3.2.5 | Click the **×** next to an item. | Item removed. Calendar cell updates. |
| 3.2.6 | Click the same day again (already selected). | DayEditor closes (toggle behavior). |

### 3.3 Holiday Marking
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.3.1 | Open a DayEditor. Toggle **Holiday** checkbox. | Day marked as holiday. Calendar cell shows grey italic "Holiday" text. Items hidden (not required for holiday). |
| 3.3.2 | Add a holiday note "Thanksgiving — no service". | Note saved. Calendar cell shows holiday note text. |
| 3.3.3 | Try to submit a menu where all non-holiday days have a HOT item. | Submit button should be enabled. |
| 3.3.4 | Untoggle the holiday. Verify the day reverts to normal. | Normal day state restored. |

### 3.4 Vendor Constraints / Planning Notes
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.4.1 | On DRAFT menu Calendar, find the amber "Vendor constraints & planning notes" banner above the grid. | Banner visible with editable textarea. |
| 3.4.2 | Type "GFS is out of salmon this month" and click elsewhere (blur). | "Saved" appears briefly in green. |
| 3.4.3 | Navigate away and return. | Notes still present. |
| 3.4.4 | On a non-DRAFT menu, verify the notes area is read-only. | Read-only banner shows the notes text. No editable textarea. |

### 3.5 AI Menu Generation
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.5.1 | On a DRAFT menu, click **Generate Menu**. | "Generating…" button state. After ~20–40 seconds, ProposalPanel opens on the right. |
| 3.5.2 | Review the proposal. Each proposed day shows a HOT item and one or more sides. | Proposal lists days with recipe assignments. Each has a reasoning note. |
| 3.5.3 | Click **Accept All** in ProposalPanel. | Items added to the calendar for all proposed days. ProposalPanel closes. |
| 3.5.4 | Click **Reject** instead. | ProposalPanel closes. No changes made to the menu. |
| 3.5.5 | Test with no API key. | 503 error displayed in button area. "Generation failed — check console" shown. |

### 3.6 Natural Language Menu Editing (NL Bar)
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.6.1 | On a DRAFT menu, locate the NLEditPanel on the right side of the layout (below the calendar). | Chat bar visible with placeholder "Ask Claude to change your menu…". |
| 3.6.2 | Type "Replace all chicken dishes in week 2 with turkey". Click **Ask Claude**. | Loading state. After response, diff panel shows proposed changes with add/remove cards. |
| 3.6.3 | Review changes. Uncheck one change. Click **Apply Selected Changes**. | Unchecked change skipped. Checked changes applied. Menu updates. Diff panel closes. |
| 3.6.4 | Click **Accept All**. | All proposed changes applied at once. |
| 3.6.5 | Click **Reject All** (or X to close without applying). | No changes made. |

### 3.7 Conflict Detection
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.7.1 | Add the same recipe to two days within 21 days. | When adding the second instance, a WARNING conflict "Recipe used recently" appears in DayEditor conflict list. |
| 3.7.2 | Add two different CHICKEN entrees on the same day. | ERROR conflict "Protein conflict" appears. |
| 3.7.3 | Add fish more than twice in one week. | WARNING "Fish frequency" conflict. |
| 3.7.4 | Verify conflict indicator chip appears on the calendar cell (red/amber dot). | Calendar cell shows conflict indicator. |
| 3.7.5 | Remove the conflicting item. | Conflict resolves. Indicator disappears. |

### 3.8 AI Substitution Suggestions
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.8.1 | With a conflict present in DayEditor, click the ✨**Fix** button next to the conflict. | SuggestionsModal opens with 1–3 swap proposals. |
| 3.8.2 | Review a proposal: old recipe strikethrough → new recipe name with reason. | Suggestions displayed clearly with meal type label. |
| 3.8.3 | Click **Apply** on a suggestion. | Old item removed, new item added. Modal closes. Conflict resolved (if applicable). |
| 3.8.4 | Close modal without applying. | No changes made. |

### 3.9 Production Counts (Actuals)
| # | Steps | Expected Result |
|---|-------|-----------------|
| 3.9.1 | Open a DayEditor for any day. Scroll to the bottom of the panel. | "Production Counts" section visible with a ❄️ snowflake icon in the header. |
| 3.9.2 | Enter a value in **Planned Overrun %** (e.g. 5). Click **Save**. | "✓ Saved" appears briefly. |
| 3.9.3 | After service, enter **Actual Prepared** = 120 and **Actual Served** = 105. Click **Save**. | Saved. Below the inputs, "15 servings available to freeze" appears in cyan text. |
| 3.9.4 | On the calendar, verify the day cell now shows a ❄️ snowflake icon in the top-right corner. | Snowflake visible. Hover shows tooltip "15 frozen servings available". |
| 3.9.5 | Set Actual Prepared = 100 and Actual Served = 100. Save. | "No overrun" text shown. Snowflake disappears from calendar cell. |
| 3.9.6 | Set Actual Prepared = 90 and Actual Served = 100. Save. | "10 serving deficit" text shown in gray. |
| 3.9.7 | Verify Planned Overrun % flows through to the Order List. Set 10% overrun for a day. Open Order List — that day's servings should be multiplied by 1.10, rounded up. | Quantities in Order List reflect the overrun multiplier. |
| 3.9.8 | On a SUBMITTED/APPROVED/PUBLISHED menu, check if Production Counts section is still editable. | Production Counts section remains editable even on locked menus (actuals can be entered post-service regardless of menu status). |

---

## 4. Approval Workflow

### 4.1 Submit for RD Review
| # | Steps | Expected Result |
|---|-------|-----------------|
| 4.1.1 | As NM, ensure all non-holiday days have at least one HOT item. | "Submit for RD Review" button appears in toolbar. |
| 4.1.2 | Add a day without a HOT item (not a holiday). | "Submit for RD Review" button disappears or is disabled. |
| 4.1.3 | Restore HOT items to all days. Click **Submit for RD Review**. | Menu status changes to SUBMITTED. Edit controls disappear. |

### 4.2 RD Approval Queue
| # | Steps | Expected Result |
|---|-------|-----------------|
| 4.2.1 | Log in as DIETITIAN. Click **RD Review** in sidebar. | Approval queue shows submitted menus. |
| 4.2.2 | Click a menu in the queue. | RDReviewDetail page opens showing the menu grid plus review actions. |
| 4.2.3 | Click **Generate AI Review** (if button visible). | AI Summary panel appears with PASS/WARNING/ERROR status, compliance bars, flagged days, key findings. |
| 4.2.4 | Review the AI summary. Note the "Advisory" disclaimer at the bottom. | Disclaimer present — "This AI summary is advisory only…" |
| 4.2.5 | Click **Approve**. | Confirmation dialog. Confirm. Menu transitions to APPROVED. Redirected to queue. |
| 4.2.6 | In a separate test: try to approve a menu you submitted yourself (using the same account for both roles). | Error: "You cannot approve a menu you submitted." |

### 4.3 RD Rejection
| # | Steps | Expected Result |
|---|-------|-----------------|
| 4.3.1 | As DIETITIAN, click **Reject** on a SUBMITTED menu. | Rejection dialog opens with RD notes textarea. |
| 4.3.2 | Enter rejection notes. Click **Confirm Rejection**. | Menu transitions back to DRAFT. Notes saved as `rd_notes`. |
| 4.3.3 | As NM, view the rejected menu. | rd_notes visible (check implementation — may appear in toolbar or info banner). Menu editable again. |

---

## 5. Publish & Kitchen View

### 5.1 Publish Menu
| # | Steps | Expected Result |
|---|-------|-----------------|
| 5.1.1 | As NM/ADMIN, view an APPROVED menu. | "Publish Menu" button visible in toolbar. |
| 5.1.2 | Click **Publish Menu**. | Status badge changes to PUBLISHED. |
| 5.1.3 | Verify "Order List" button appears now. | 📦 Order List button visible in toolbar. |

### 5.2 Client Narrative
| # | Steps | Expected Result |
|---|-------|-----------------|
| 5.2.1 | On PUBLISHED menu (as NM/ADMIN), find the blue "Client Menu Narrative" banner. | Editable textarea visible with ✨ Generate and Save buttons. |
| 5.2.2 | Click ✨ **Generate**. | "Writing…" state. After ~5 seconds, narrative text populates the textarea. |
| 5.2.3 | Edit the narrative manually. Click **Save**. | "Saved" appears. |
| 5.2.4 | Export PDF. Verify narrative appears in the header. | PDF header shows narrative text below the title/date row. |

### 5.3 Order List
| # | Steps | Expected Result |
|---|-------|-----------------|
| 5.3.1 | Click 📦 **Order List**. | OrderListPanel opens on the right. Week 1 selected by default. |
| 5.3.2 | Change Default servings/day to 150. | Ingredient quantities recalculate. |
| 5.3.3 | Override headcount for one day (e.g., Mon → 75). Tab/Enter to save. | That day's servings update. Quantities recalculate. |
| 5.3.4 | Switch between Week 1, 2, 3, 4. | Each week shows its own ingredient list. |
| 5.3.5 | GFS items appear in the blue section. Untagged ingredients appear in amber section with ⚠ icon. | Visual grouping correct. |
| 5.3.6 | Click **CSV** export button. | Browser downloads a `.csv` file. Open in Excel — columns are: Ingredient, Total Qty, Unit, Product Code, Case Size, Order Unit, Recipes. |
| 5.3.7 | Click **PDF** export button. | PDF opens in new tab. Header shows menu month/year and week. GFS, other, and untagged sections present. |

### 5.4 Kitchen View
| # | Steps | Expected Result |
|---|-------|-----------------|
| 5.4.1 | Log in as KITCHEN_STAFF. | Automatically redirected to `/kitchen`. |
| 5.4.2 | Verify the current published menu's calendar appears. | Read-only month grid with recipe names. Color-coded by meal type. |
| 5.4.3 | Verify there are no edit controls. | No "Create Menu", "Generate Menu", DayEditor, or any edit buttons. |
| 5.4.4 | Click **Print Menu PDF**. | PDF download starts. Menu calendar PDF matches the published layout. |
| 5.4.5 | Archive the published menu (as ADMIN). Then reload kitchen view. | "No published menu available" empty state displayed. |

### 5.5 Archive
| # | Steps | Expected Result |
|---|-------|-----------------|
| 5.5.1 | As ADMIN, view a PUBLISHED menu. | "Archive" button visible. |
| 5.5.2 | Click **Archive**. | Status changes to ARCHIVED. Archive button disappears. |
| 5.5.3 | As NM (non-ADMIN), try to archive. | No Archive button visible. |

---

## 6. Nutrition & Compliance

### 6.1 Nutrition Panel
| # | Steps | Expected Result |
|---|-------|-----------------|
| 6.1.1 | View any menu with items. When no day is selected, the right panel shows the NutritionPanel. | Nutrition panel visible with DRI compliance bars. |
| 6.1.2 | Verify compliance bars show % of DRI met for: Calories, Protein, Fat, Carbs, Sodium, Fiber, Calcium, Vitamin D, Vitamin C, Potassium. | All 10 nutrient bars render. Colors: green = met, amber = close, red = below target. |
| 6.1.3 | Verify the "Monthly Average" row appears at the bottom. | Average across all non-holiday days shown. |
| 6.1.4 | Add a recipe with no USDA-linked ingredients. | That recipe name appears in "No nutrition data" warning list. |

---

## 7. Client Feedback & Ratings

### 7.1 Submit Feedback (Anonymous)
| # | Steps | Expected Result |
|---|-------|-----------------|
| 7.1.1 | Using the API (or a test form), POST to `/api/feedback` with `{ menu_day_item_id: "<valid id>", rating: 4, comment: "Great chicken!" }`. | 201 response with feedback record. |
| 7.1.2 | Submit with `rating: 6` (out of range). | 400 error: "rating must be between 1 and 5". |
| 7.1.3 | Submit with an invalid `menu_day_item_id`. | 404 error. |

### 7.2 Ratings Dashboard
| # | Steps | Expected Result |
|---|-------|-----------------|
| 7.2.1 | As NM/DIETITIAN/ADMIN, navigate to **Ratings** in sidebar. | Client Ratings page loads. Recipe list appears. |
| 7.2.2 | For a recipe with ratings, verify average star display and count. | Stars filled proportionally to avg. Count shows "(N ratings)". |
| 7.2.3 | Recipe with avg < 3.0 should have a red row highlight. | Red background visible on low-rated recipe rows. |
| 7.2.4 | Click a recipe row to expand it. | Comments list appears below the recipe row. |
| 7.2.5 | Use category filter buttons (ALL, HOT_ENTREE, etc.). | List filters to the selected category. |

### 7.3 AI Feedback Insights (NM / ADMIN only)
| # | Steps | Expected Result |
|---|-------|-----------------|
| 7.3.1 | As NM/ADMIN on the Ratings page, find the AI Insights panel above the recipe table. | Panel visible with a **✨ Generate Insights** button. |
| 7.3.2 | Click **Generate Insights** (requires ≥ 5 total ratings in the system). | Loading state ("Generating…"). After ~10 seconds, insight cards appear. |
| 7.3.3 | Verify insight cards show a type badge (🏆 celebrate, 📉 retire, ⬇ reduce, ⬆ increase, 📅 seasonal) and a recommendation sentence. | Each card has a colored badge, recipe name (linked to recipe detail), recommendation, and supporting data. |
| 7.3.4 | Verify a "Data quality" note appears at the top of the panel if data is limited. | Data quality label present (e.g. "Good" or "Limited"). |
| 7.3.5 | Click a recipe name link in an insight card. | Navigates to the recipe detail page. |
| 7.3.6 | With fewer than 5 total ratings in the system, click **Generate Insights**. | Message displayed: "Not enough feedback data yet." No AI call made. |
| 7.3.7 | As DIETITIAN (not NM/ADMIN), verify the Insights panel is not visible. | Panel does not appear for DIETITIAN role. |
| 7.3.8 | Test with no `ANTHROPIC_API_KEY`. Click **Generate Insights**. | Error state shown inline. No crash. |

### 7.4 Frozen Stock
| # | Steps | Expected Result |
|---|-------|-----------------|
| 7.4.1 | As NM/ADMIN/KITCHEN_STAFF, navigate to **Frozen Stock** in sidebar. | Frozen Stock page loads with "Stock Log" tab active. ❄️ icon in header. |
| 7.4.2 | Click **Log Overrun**. In the modal, search for a recipe, enter servings (e.g. 25), set prepared date. Click **Log Entry**. | Entry appears in the Stock Log table. Status shows "Available" in cyan. |
| 7.4.3 | Log entry with no recipe selected. Click **Log Entry**. | Button disabled — cannot submit without a recipe. |
| 7.4.4 | Log entry with servings = 0. | Validation error from API: "servings must be a positive integer." |
| 7.4.5 | Click **Mark Used** on an available entry. | Used date set to today. Row updates to show a green ✓ checkmark and today's date. |
| 7.4.6 | Check the "Show used entries" checkbox. | Used entries appear in the log alongside available ones. |
| 7.4.7 | Click the **×** delete icon on an entry (NM/ADMIN only). | Entry removed from the list. |
| 7.4.8 | As **KITCHEN_STAFF**, verify the delete icon is not visible. | Delete button absent for KITCHEN_STAFF role. |
| 7.4.9 | As NM/ADMIN, click the **Overrun Report** tab. | Monthly report loads, grouped by month, sorted by most overrun first. |
| 7.4.10 | Verify the Overrun Report shows: recipe name, category, total servings, entries per month. | All four columns present. Month heading shows "Month YYYY" format. |
| 7.4.11 | Verify KITCHEN_STAFF does not see the Overrun Report tab. | Tab absent for KITCHEN_STAFF. |

---

## 8. Admin — User Management

### 8.1 View Users
| # | Steps | Expected Result |
|---|-------|-----------------|
| 8.1.1 | Log in as ADMIN. Go to **Admin → Users**. | User Management page lists all users with name, email, role badge, and active status. |
| 8.1.2 | Verify role badges are color-coded (ADMIN = red, NM = blue, DIETITIAN = green, KITCHEN = gray). | Correct colors per role. |

### 8.2 Create User
| # | Steps | Expected Result |
|---|-------|-----------------|
| 8.2.1 | Click **New User**. Fill in name, email, role, password. Click **Save**. | User created. Appears in the table. |
| 8.2.2 | Log in with the new user's credentials. | Login succeeds. User has the correct role-based experience. |
| 8.2.3 | Try creating a user with a duplicate email. | Error: "Email already in use." |
| 8.2.4 | Try creating with a blank name. | Validation error. |

### 8.3 Edit User
| # | Steps | Expected Result |
|---|-------|-----------------|
| 8.3.1 | Click the edit icon on a user. Change their role. Click **Save**. | Role badge updates in the table. |
| 8.3.2 | Deactivate a user (uncheck "Active"). | User shows as inactive. That user can no longer log in. |
| 8.3.3 | Try to deactivate your own account. | Error: "Cannot deactivate your own account." |

---

## 9. Edge Cases & Error Handling

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 9.1 | Navigate to a month with no menu. | "No menu for this month" with Create button. |
| 9.2 | Open kitchen view when no published menu exists. | "No menu currently published" empty state. No errors. |
| 9.3 | All AI features when `ANTHROPIC_API_KEY` is missing/invalid. | 503 error message shown inline. No application crash. Specific message: "AI service unavailable — ANTHROPIC_API_KEY not configured." |
| 9.4 | Generate Order List for a week with all holidays (no active days). | Empty list returned. "No items for this week" empty state in panel. |
| 9.5 | Attempt to edit a SUBMITTED/APPROVED/PUBLISHED/ARCHIVED menu. | Edit controls hidden. Direct API calls return 403. |
| 9.6 | Export PDF for a menu that is not PUBLISHED. | 403 error: "Only PUBLISHED menus can be exported." |
| 9.7 | Access Order List for a DRAFT menu. | 400 error / Order List button not visible. |
| 9.8 | Network error during page load. | React Query displays loading state, then error boundary or inline error message. No blank white screen. |
| 9.9 | Session expires while using the app. | Next API call returns 401. App redirects to `/login`. |
| 9.10 | Two NMs create a menu for the same month simultaneously. | Second attempt returns 409 "A menu for YYYY-M already exists". |

---

## 10. PDF Export Verification

| # | Document | Check |
|---|----------|-------|
| 10.1 | Monthly Menu Calendar PDF | Header: "HOT MENU" + Month + Year + COA contact info |
| 10.2 | Monthly Menu Calendar PDF | Client narrative text appears in header (if set) |
| 10.3 | Monthly Menu Calendar PDF | Mon–Fri grid, date numbers top-right of each cell |
| 10.4 | Monthly Menu Calendar PDF | HOT items bold black, COLD items COA blue, SIDE/FRUIT/BREAD dark green, DESSERT purple |
| 10.5 | Monthly Menu Calendar PDF | Holiday cells show grey italic holiday note |
| 10.6 | Recipe Card PDF | Header: recipe name + category, COA branding |
| 10.7 | Recipe Card PDF | Info table: yield, utensil, serving size, temps |
| 10.8 | Recipe Card PDF | Ingredients in two columns, quantities shown |
| 10.9 | Recipe Card PDF | CCP instruction steps are bold |
| 10.10 | Order List PDF | Header: "INGREDIENT ORDER LIST" + month + week |
| 10.11 | Order List PDF | GFS / Other / Untagged sections with distinct colored headers |
| 10.12 | Order List PDF | Untagged items shown in amber color |

---

## 11. Performance Checks

| # | Check | Target |
|---|-------|--------|
| 11.1 | Menu Calendar page load (with menu) | < 2 seconds |
| 11.2 | DayEditor open + recipe search results | < 500ms |
| 11.3 | AI menu generation | < 60 seconds (typically 15–30s) |
| 11.4 | AI natural language edit | < 30 seconds |
| 11.5 | PDF export download start | < 5 seconds |
| 11.6 | Order List calculation | < 3 seconds |
| 11.7 | USDA ingredient search | < 2 seconds |

---

## 12. Pre-Deployment Checklist

Before going live on production, confirm all of the following:

- [ ] All database migrations (001–010) have been run on the production database
- [ ] `ANTHROPIC_API_KEY` is set in Cloud Run environment variables
- [ ] `SESSION_SECRET` is set (strong random value, not a default)
- [ ] `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none` set for cross-origin Firebase → Cloud Run
- [ ] `NODE_ENV=production` set in Cloud Run
- [ ] At least one ADMIN user created via seed or manual SQL
- [ ] `VITE_API_URL` set to the Cloud Run URL in the Firebase build pipeline
- [ ] Firebase Hosting deployed (latest build pushed to `main` under `apps/web/`)
- [ ] Cloud Run deployed (latest build pushed to `main` under `apps/api/`)
- [ ] `/api/auth/me` returns 401 (not 500) when not logged in
- [ ] Login with ADMIN account succeeds on production URL
- [ ] Kitchen view (`/kitchen`) loads without errors
- [ ] PDF export downloads successfully from the production URL

---

## 13. Test Data Reset (For Staging Only)

If you need to reset staging data between test runs:

1. Delete all menus for the test month via SQL or by archiving them.
2. To reset a menu to DRAFT: `UPDATE menus SET status = 'DRAFT' WHERE id = '<id>';`
3. To clear feedback data: `TRUNCATE client_feedback;`
4. To clear frozen stock data: `TRUNCATE frozen_stock;`
5. To reset actuals on menu days: `UPDATE menu_days SET actual_prepared = NULL, actual_served = NULL, planned_overrun_pct = 0;`
6. Do **NOT** truncate `recipes` or `users` — the seed data should persist.

---

*Document prepared for St. Joseph County Commission on Aging.*  
*Questions: contact the DICELabs development team.*
