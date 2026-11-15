import Anthropic from '@anthropic-ai/sdk';
import sql from '../db/client.js';
import { REPEAT_CYCLE_DAYS, repeatCycleFor } from './repeatCycles.js';
import { checkDRICompliance } from './compliance.js';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const OAA_TARGETS_TEXT = `
- Calories:      ≥ 600 kcal
- Protein:       ≥ 19 g
- Fiber:         ≥ 8 g
- Sodium:        ≤ 800 mg
- Calcium:       ≥ 400 mg
- Vitamin D:     ≥ 5 mcg
- Vitamin C:     ≥ 28 mg
- Potassium:     ≥ 1,167 mg
- Saturated Fat: < 10% of calories`.trim();

const CONFLICT_RULES_TEXT = `
1. PROTEIN_CONFLICT (Error): Same protein group cannot appear in both HOT and COLD entree on the same day.
2. FISH_FREQUENCY (Warning): Fish protein ≤ 2 times per Mon–Fri week.
3. RECIPE_REPEAT (Warning): A recipe should not reappear within its category's repeat cycle — HOT_ENTREE ${REPEAT_CYCLE_DAYS.HOT_ENTREE} days, COLD_ENTREE ${REPEAT_CYCLE_DAYS.COLD_ENTREE} days, SIDE ${REPEAT_CYCLE_DAYS.SIDE} days, DESSERT ${REPEAT_CYCLE_DAYS.DESSERT} days, FRUIT ${REPEAT_CYCLE_DAYS.FRUIT} days, BREAD ${REPEAT_CYCLE_DAYS.BREAD} days.
4. WEEKLY_REPEAT (Warning): The same FRUIT or BREAD recipe should not appear 3 or more times in one Mon–Fri week.`.trim();

const SUBMIT_TOOL = {
  name: 'submit_menu_proposal',
  description: 'Submit the complete menu proposal as structured data. Call this once with all suggestions.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        description: 'One entry per service date that needs new items suggested',
        items: {
          type: 'object',
          properties: {
            service_date: { type: 'string', description: 'YYYY-MM-DD' },
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  recipe_id:   { type: 'string', description: 'UUID from the recipe database' },
                  recipe_name: { type: 'string' },
                  meal_type: {
                    type: 'string',
                    enum: ['HOT', 'COLD', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'],
                    description: 'HOT = hot entree, COLD = cold entree',
                  },
                  reason: { type: 'string', description: 'One sentence explaining why this was chosen' },
                },
                required: ['recipe_id', 'recipe_name', 'meal_type', 'reason'],
              },
            },
          },
          required: ['service_date', 'suggestions'],
        },
      },
    },
    required: ['days'],
  },
};

export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to apps/api/.env for local dev, or to GCP Secret Manager (COA_MENU_ANTHROPIC_API_KEY) for staging.'
    );
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getSeason(month) {
  if (month >= 3 && month <= 5) return 'SPRING';
  if (month >= 6 && month <= 8) return 'SUMMER';
  if (month >= 9 && month <= 11) return 'FALL';
  return 'WINTER';
}

function buildRecipeContext(recipes, ratingMap = {}) {
  const byCategory = {};
  for (const r of recipes) {
    (byCategory[r.category] ??= []).push(r);
  }

  const categoryOrder = ['HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];
  const lines = [];

  for (const cat of categoryOrder) {
    const items = byCategory[cat];
    if (!items?.length) continue;
    lines.push(`\n### ${cat}`);
    for (const r of items) {
      let line = `  - [${r.id}] ${r.name} | protein:${r.protein_group}`;
      if (r.seasons?.length) line += ` | seasons:${r.seasons.join(',')}`;
      // Nutrition flags
      if (r.vitamin_d_mcg >= 2)  line += ` | good Vit-D`;
      if (r.vitamin_c_mg  >= 15) line += ` | good Vit-C`;
      if (r.calcium_mg    >= 100) line += ` | good Ca`;
      if (r.fiber_g       >= 3)  line += ` | good fiber`;
      if (r.sodium_mg     >= 600) line += ` | HIGH sodium`;
      // Client rating annotations (only when ≥ 3 responses)
      const rating = ratingMap[r.id];
      if (rating && rating.count >= 3) {
        if (rating.avg >= 4.0) {
          line += ` | ⭐ CLIENT FAVORITE (${rating.avg.toFixed(1)}/5, ${rating.count} ratings) — prefer when nutritionally compliant`;
        } else if (rating.avg < 3.0) {
          line += ` | ⚠ LOW-RATED (${rating.avg.toFixed(1)}/5, ${rating.count} ratings) — avoid unless no compliant alternative`;
        }
      }
      lines.push(line);
    }
  }

  return lines.join('\n');
}

// ── RD Review Summary ──────────────────────────────────────────────────────────

const REVIEW_SUMMARY_TOOL = {
  name: 'submit_review_summary',
  description: 'Submit the structured RD review summary. Call once with the complete analysis.',
  input_schema: {
    type: 'object',
    properties: {
      overall_status: {
        type: 'string',
        enum: ['PASS', 'WARNING', 'ERROR'],
        description: 'PASS = all clear, WARNING = minor issues, ERROR = compliance failures',
      },
      compliant_days: { type: 'number', description: 'Days meeting all OAA DRI targets' },
      total_active_days: { type: 'number', description: 'Non-holiday days with at least one item' },
      flagged_days: {
        type: 'array',
        description: 'Days with compliance issues',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            reasons: { type: 'array', items: { type: 'string' }, description: 'List of specific issues' },
          },
          required: ['date', 'reasons'],
        },
      },
      conflict_count: { type: 'number', description: 'Number of unresolved conflicts' },
      key_findings: {
        type: 'array',
        items: { type: 'string' },
        description: '3–6 concise bullet-point findings (protein coverage, fish frequency, repeat recipes, sodium, etc.)',
      },
      recommended_action: {
        type: 'string',
        description: 'One or two sentences telling the RD exactly what to focus on before approving or rejecting',
      },
    },
    required: ['overall_status', 'compliant_days', 'total_active_days', 'flagged_days', 'conflict_count', 'key_findings', 'recommended_action'],
  },
};

export async function generateRDSummary({ menu, days, nutritionDays, conflicts }) {
  const client = getClient();

  const monthName = MONTH_NAMES[menu.month - 1];

  // Build a compact nutrition table for Claude
  const nutritionLines = nutritionDays
    .filter(d => !d.is_holiday)
    .map(d => {
      const date = new Date(d.service_date).toISOString().slice(0, 10);
      const t = d.totals;
      const flags = d.compliance.filter(c => !c.meets_target).map(c => c.nutrient);
      return `  ${date}: cal=${t.calories_kcal} prot=${t.protein_g}g fiber=${t.fiber_g}g sodium=${t.sodium_mg}mg${flags.length ? ` | FAILS: ${flags.join(', ')}` : ' | OK'}`;
    });

  // Build conflict summary
  const conflictLines = conflicts.map(c =>
    `  [${c.severity}] ${c.description}`
  );

  // Recipe repeat analysis — find any recipe reappearing within its category cycle
  const allItems = days.flatMap(d =>
    (d.items ?? []).map(i => ({
      date: new Date(d.service_date).toISOString().slice(0, 10),
      recipe_id: i.recipe_id,
      recipe_name: i.recipe_name,
      category: i.category,
    }))
  );
  const repeatWarnings = [];
  const seenRecipes = {};
  for (const item of allItems.sort((a, b) => a.date.localeCompare(b.date))) {
    const prev = seenRecipes[item.recipe_id];
    if (prev) {
      const daysDiff = Math.round((new Date(item.date) - new Date(prev)) / 86400000);
      const cycleDays = repeatCycleFor(item.category);
      if (daysDiff <= cycleDays) {
        repeatWarnings.push(`${item.recipe_name}: appeared on ${prev} and ${item.date} (${daysDiff} days apart, ${cycleDays}-day cycle)`);
      }
    }
    seenRecipes[item.recipe_id] = item.date;
  }

  // Fish frequency analysis — count fish per Mon–Fri week
  const fishItems = allItems.filter(i => {
    // Fish protein group check — look at days items
    const dayData = days.find(d => new Date(d.service_date).toISOString().slice(0, 10) === i.date);
    const item = (dayData?.items ?? []).find(x => x.recipe_id === i.recipe_id);
    return item?.protein_group === 'FISH' || item?.protein_group === 'SEAFOOD';
  });
  const fishByWeek = {};
  for (const fi of fishItems) {
    const d = new Date(fi.date + 'T12:00:00Z');
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - (d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1));
    const wk = weekStart.toISOString().slice(0, 10);
    fishByWeek[wk] = (fishByWeek[wk] ?? 0) + 1;
  }
  const fishOverLimit = Object.entries(fishByWeek)
    .filter(([, count]) => count > 2)
    .map(([week, count]) => `Week of ${week}: ${count} fish servings`);

  // Recipe pool coverage — flag categories whose active recipe pool is smaller
  // than their repeat cycle, which makes that cycle impossible to fully satisfy.
  const recipeCounts = await sql`
    SELECT category, COUNT(*)::int AS cnt
    FROM recipes WHERE is_active = true
    GROUP BY category
  `;
  const POOL_CATEGORY_LABELS = {
    HOT_ENTREE: 'hot entrees', COLD_ENTREE: 'cold entrees', SIDE: 'sides',
    FRUIT: 'fruit', BREAD: 'bread', DESSERT: 'desserts',
  };
  const poolWarnings = recipeCounts
    .filter(rc => POOL_CATEGORY_LABELS[rc.category] && rc.cnt < repeatCycleFor(rc.category))
    .map(rc => `Only ${rc.cnt} active ${POOL_CATEGORY_LABELS[rc.category]} in the database — the ${repeatCycleFor(rc.category)}-day repeat cycle cannot be fully satisfied; consider adding more recipes`);

  const prompt = `You are reviewing a submitted COA meal program menu on behalf of the program dietitian.

**Program:** St. Joseph County Commission on Aging — OAA Title III-C Congregate Meal Program
**Menu:** ${monthName} ${menu.year}

## OAA DRI Targets (per meal)
${OAA_TARGETS_TEXT}

## Daily Nutrition & Compliance
${nutritionLines.join('\n') || '  No nutrition data available.'}

## Unresolved Conflicts (${conflicts.length})
${conflictLines.length > 0 ? conflictLines.join('\n') : '  None.'}

## Recipe Repeat Violations (per-category repeat cycle)
${repeatWarnings.length > 0 ? repeatWarnings.map(r => `  ${r}`).join('\n') : '  None detected.'}

## Fish Frequency Violations (> 2x/week)
${fishOverLimit.length > 0 ? fishOverLimit.map(r => `  ${r}`).join('\n') : '  None detected.'}

## Recipe Pool Coverage
${poolWarnings.length > 0 ? poolWarnings.map(w => `  ${w}`).join('\n') : '  All categories have enough recipes to satisfy their repeat cycle.'}

Based on the above data, call submit_review_summary with a concise, accurate review summary.
- overall_status: ERROR if any compliance failures exist, WARNING if only minor issues, PASS if all clear
- Be specific about which days and nutrients are failing
- Recipe pool coverage gaps are informational — mention them as a recommendation, never as a reason to fail the menu
- key_findings should be 3–6 bullets covering protein variety, fish frequency, repeat recipes, recipe pool gaps, sodium trends, and any outstanding conflicts
- recommended_action should be direct and actionable for the RD`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    tools: [REVIEW_SUMMARY_TOOL],
    tool_choice: { type: 'tool', name: 'submit_review_summary' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a review summary');
  return toolUse.input;
}

// ── Menu Narrative ────────────────────────────────────────────────────────────

export async function generateMenuNarrative(menu, days) {
  const client = getClient();
  const monthName = MONTH_NAMES[menu.month - 1];
  const season = getSeason(menu.month);

  // Collect highlights: unique recipe names across the month, grouped by type
  const allItems = days.flatMap(d => d.items ?? []);
  const hotEntrees  = [...new Set(allItems.filter(i => i.meal_type === 'HOT').map(i => i.recipe_name))];
  const coldEntrees = [...new Set(allItems.filter(i => i.meal_type === 'COLD').map(i => i.recipe_name))];
  const sides       = [...new Set(allItems.filter(i => i.meal_type === 'SIDE').map(i => i.recipe_name))];
  const fruits      = [...new Set(allItems.filter(i => i.meal_type === 'FRUIT').map(i => i.recipe_name))];
  const desserts    = [...new Set(allItems.filter(i => i.meal_type === 'DESSERT').map(i => i.recipe_name))];
  const holidays    = days.filter(d => d.is_holiday).map(d => d.holiday_note).filter(Boolean);

  const prompt = `Write a short, warm, friendly menu introduction for a senior meal program.

**Program:** St. Joseph County Commission on Aging — Congregate Meal Program
**Month:** ${monthName} ${menu.year}
**Season:** ${season}

**Hot Entrees this month:** ${hotEntrees.slice(0, 6).join(', ') || 'variety of hot entrees'}
**Cold Entrees:** ${coldEntrees.slice(0, 4).join(', ') || 'variety of cold options'}
**Sides:** ${sides.slice(0, 5).join(', ') || 'seasonal sides'}
**Fruits:** ${fruits.slice(0, 4).join(', ') || 'seasonal fruits'}
**Desserts:** ${desserts.slice(0, 4).join(', ') || 'assorted desserts'}
${holidays.length ? `**Special occasions:** ${holidays.join(', ')}` : ''}

Write 3–4 sentences that:
- Welcome clients to the month's menu warmly and personally
- Highlight 2–3 appealing dishes by name
- Mention the season and any special occasions if applicable
- Sound friendly and appropriate for seniors 70+
- Do NOT mention nutrition, calories, or health claims

Respond with only the narrative text — no title, no quotes, no explanation.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.text?.trim() ?? '';
}

// ── AI Recipe Creation ────────────────────────────────────────────────────────

const GENERATE_RECIPE_TOOL = {
  name: 'submit_recipe',
  description: 'Submit the complete generated recipe in COA standardized format.',
  input_schema: {
    type: 'object',
    properties: {
      name:            { type: 'string', description: 'Full recipe name as it would appear on a menu card' },
      category:        { type: 'string', enum: ['HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'] },
      protein_group:   { type: 'string', enum: ['CHICKEN', 'FISH', 'BEEF', 'PORK', 'EGG', 'LEGUME', 'OTHER'], description: 'Omit for non-protein items like sides/fruit/bread' },
      seasons:         { type: 'array', items: { type: 'string', enum: ['SPRING', 'SUMMER', 'FALL', 'WINTER'] }, description: 'Seasons this recipe is appropriate for' },
      base_servings:   { type: 'number', description: 'Always 100 for COA quantity recipes' },
      serving_size_oz: { type: 'number', description: 'Portion size in ounces per senior' },
      serving_utensil: { type: 'string', description: 'e.g. "4 oz spoodle", "2 slices", "3 oz ladle"' },
      cooking_temp_f:  { type: 'number', description: 'Oven or cooking temperature in °F if applicable' },
      internal_temp_f: { type: 'number', description: 'Required internal temperature for food safety (CCP)' },
      instructions:    { type: 'string', description: 'Numbered production instructions (1. Preheat oven... 2. ...) followed by CCP notes on a new line starting with "CCP:"' },
      ingredients: {
        type: 'array',
        description: 'Ingredient list scaled to 100 servings',
        items: {
          type: 'object',
          properties: {
            ingredient_name:       { type: 'string', description: 'Standard food service ingredient name as ordered from GFS or equivalent' },
            quantity_per_100_svgs: { type: 'number', description: 'Quantity needed for exactly 100 servings' },
            unit:                  { type: 'string', description: 'e.g. lbs, oz, cups, each, #10 can, gallons' },
            vendor:                { type: 'string', description: 'Likely vendor: "GFS" for pantry/packaged/frozen/protein items, "LOCAL" for fresh seasonal produce, "OTHER" for specialty items' },
          },
          required: ['ingredient_name', 'quantity_per_100_svgs', 'unit', 'vendor'],
        },
      },
    },
    required: ['name', 'category', 'seasons', 'base_servings', 'serving_size_oz', 'serving_utensil', 'instructions', 'ingredients'],
  },
};

// Parse pasted recipe text from an external source into COA schema.
// Reuses GENERATE_RECIPE_TOOL — same output format as generateRecipe.
export async function parseRecipeFromText({ text, sourceName, categoryHint }) {
  const client = getClient();

  const prompt = `You are parsing a recipe from an external source into COA standardized format for a senior meal program (St. Joseph County Commission on Aging).

## Source Recipe Text
${text}

## Target Format Requirements
- Yield: scale ALL ingredients to exactly 100 servings. If the original recipe serves a different number, scale every quantity proportionally.
- All quantities must use institutional/food service scale (lbs, cases, gallons — not household cups/tsp where impractical)
- Serving sizes appropriate for seniors 70+ (typically 4–6 oz protein entrees, 4 oz sides, 4 oz fruit)
- Instructions must be numbered, practical for a commercial kitchen, and include CCP food safety notes at relevant steps
- If the source recipe has incomplete instructions, fill in standard commercial kitchen steps

## OAA Nutrition Targets (per meal)
${OAA_TARGETS_TEXT}
${sourceName ? `\n## Original Source\n${sourceName}` : ''}
${categoryHint ? `\n## Suggested Category\n${categoryHint} (use your judgment if the recipe clearly fits a different category)` : ''}

## Instructions
Parse this recipe and call submit_recipe with the complete standardized COA record.
- Preserve the original recipe name (you may lightly format it for title case)
- If yield/servings are not stated, assume the recipe serves 25 and scale to 100
- Choose the most appropriate category from the enum if no hint is provided
- For vendor: "GFS" for shelf-stable/frozen/protein items, "LOCAL" for fresh produce
- Flag any ingredients that appear unusual or may not scale well in the supporting_data (don't fail — just note it in instructions)

Call submit_recipe with the complete recipe.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    tools: [GENERATE_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_recipe' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a parsed recipe');

  const recipe = toolUse.input;
  if (!recipe.name || !recipe.category || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new Error('Parsed recipe failed validation — missing required fields');
  }

  return recipe;
}

export async function generateRecipe({ description, category, season, constraints, exampleRecipes }) {
  const client = getClient();

  const seasonText = season ? `Primary season: ${season}.` : '';
  const constraintsText = constraints?.trim() ? `Additional constraints: ${constraints.trim()}` : '';

  const examplesText = exampleRecipes?.length
    ? `## Example COA Recipes (for format reference)\n` +
      exampleRecipes.slice(0, 3).map(r =>
        `### ${r.name} (${r.category})\nServings: ${r.base_servings} | Size: ${r.serving_size_oz ?? '?'} oz | Utensil: ${r.serving_utensil ?? '?'}\nInstructions excerpt: ${(r.instructions ?? '').slice(0, 200)}...`
      ).join('\n\n')
    : '';

  const prompt = `You are a professional quantity food service recipe developer for a senior meal program.

Create a complete, standardized production recipe for 100 servings based on this request:

**Description:** ${description}
**Category:** ${category}
${seasonText}
${constraintsText}

## Recipe Requirements
- Yield: exactly 100 servings for senior congregate dining
- All ingredients must be standard food service items available from GFS or equivalent broadline distributor
- Portion sizes appropriate for seniors 70+ (typically 4–6 oz protein, 4 oz sides)
- Instructions must be numbered, practical for a commercial kitchen, and include CCP food safety notes
- Aim to support OAA DRI targets: ≥600 kcal, ≥19g protein, ≥8g fiber, ≤800mg sodium, ≥400mg calcium

## OAA Nutrition Targets (per meal)
${OAA_TARGETS_TEXT}

${examplesText}

Call submit_recipe with the complete recipe. Be specific and realistic — ingredients with exact quantities for 100 servings, practical oven temps and cook times, and clear numbered instructions a kitchen worker can follow.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    tools: [GENERATE_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_recipe' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a recipe');

  const recipe = toolUse.input;

  // Basic validation
  if (!recipe.name || !recipe.category || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new Error('Generated recipe failed validation — missing required fields');
  }

  return recipe;
}

// ── Conflict Substitution Suggestions ────────────────────────────────────────

const SUGGESTIONS_TOOL = {
  name: 'submit_substitution_suggestions',
  description: 'Submit 1–3 substitution suggestions to resolve the conflict. Call once.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: 0,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            replace_item_id:  { type: 'string', description: 'UUID of the menu_day_item to remove' },
            replace_recipe_name: { type: 'string', description: 'Name of the recipe being replaced' },
            with_recipe_id:   { type: 'string', description: 'UUID of the recipe to add instead' },
            with_recipe_name: { type: 'string', description: 'Name of the replacement recipe' },
            meal_type:        { type: 'string', enum: ['HOT', 'COLD', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'] },
            reason:           { type: 'string', description: 'One sentence explaining why this swap resolves the conflict' },
          },
          required: ['replace_item_id', 'replace_recipe_name', 'with_recipe_id', 'with_recipe_name', 'meal_type', 'reason'],
        },
      },
    },
    required: ['suggestions'],
  },
};

export async function generateConflictSuggestions({ conflict, dayItems, recipes, recentlyUsedIds }) {
  const client = getClient();

  const currentItemsText = dayItems
    .map(i => `  [${i.id}] ${i.meal_type}: ${i.recipe_name} (protein:${i.protein_group ?? 'unknown'})`)
    .join('\n');

  // Filter to recipes that could plausibly resolve the conflict — same categories as current items
  const relevantCategories = [...new Set(dayItems.map(i => i.category))];
  const relevantRecipes = recipes
    .filter(r => relevantCategories.includes(r.category))
    .filter(r => !recentlyUsedIds.has(r.id)); // exclude recently used (21-day rule)

  const recipeList = relevantRecipes.map(r => {
    let line = `  [${r.id}] ${r.category} | ${r.name} | protein:${r.protein_group ?? 'unknown'}`;
    if (r.sodium_mg >= 600) line += ' | HIGH sodium';
    if (r.fiber_g >= 3) line += ' | good fiber';
    return line;
  }).join('\n');

  const prompt = `You are resolving a menu conflict for the St. Joseph County COA meal program.

## Conflict to Resolve
Type: ${conflict.conflict_type}
Severity: ${conflict.severity}
Description: ${conflict.description}

## Current Day Items
${currentItemsText}

## OAA Conflict Rules
${CONFLICT_RULES_TEXT}

## Available Replacement Recipes (same categories, not recently used)
${recipeList || '  None available.'}

## Task
Suggest 1–3 specific item swaps that would resolve this conflict without creating new ones.
- Only reference item IDs and recipe IDs listed above.
- Each suggestion replaces exactly one item.
- Prefer swaps that also improve DRI compliance.
- If no valid swap exists, return an empty suggestions array.

Call submit_substitution_suggestions with your proposals.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    tools: [SUGGESTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'submit_substitution_suggestions' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return substitution suggestions');
  return toolUse.input.suggestions; // array of suggestion objects
}

// ── Natural Language Menu Editing ─────────────────────────────────────────────

const MENU_EDIT_TOOL = {
  name: 'submit_menu_edits',
  description: 'Submit the proposed menu changes as a structured diff. Call once with all changes.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One or two plain-English sentences summarising what changes are being made and why.',
      },
      changes: {
        type: 'array',
        description: 'Ordered list of changes to apply. Each change targets one slot on one day.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'remove', 'replace'],
              description: 'add = add new item to slot; remove = remove existing item; replace = remove existing + add new',
            },
            date:          { type: 'string', description: 'YYYY-MM-DD service date' },
            meal_type:     { type: 'string', enum: ['HOT', 'COLD', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'] },
            recipe_id:     { type: 'string', description: 'Recipe UUID to add/replace with (omit for remove)' },
            recipe_name:   { type: 'string', description: 'Human-readable recipe name (omit for remove)' },
            remove_recipe_id: { type: 'string', description: 'Recipe UUID to remove (required for remove/replace)' },
            reason:        { type: 'string', description: 'One sentence explaining why this specific change was made' },
          },
          required: ['action', 'date', 'meal_type', 'reason'],
        },
      },
    },
    required: ['summary', 'changes'],
  },
};

export async function generateMenuEdits(menuId, instruction) {
  const client = getClient();

  const [menu] = await sql`SELECT * FROM menus WHERE id = ${menuId}`;
  if (!menu) throw new Error('Menu not found');

  const days = await sql`
    SELECT md.id, md.service_date, md.is_holiday,
           COALESCE(
             json_agg(
               json_build_object(
                 'item_id',     mdi.id,
                 'recipe_id',   mdi.recipe_id,
                 'recipe_name', r.name,
                 'meal_type',   mdi.meal_type,
                 'protein_group', r.protein_group
               ) ORDER BY mdi.sort_order
             ) FILTER (WHERE mdi.id IS NOT NULL),
             '[]'
           ) AS items
    FROM menu_days md
    LEFT JOIN menu_day_items mdi ON mdi.menu_day_id = md.id
    LEFT JOIN recipes r ON r.id = mdi.recipe_id
    WHERE md.menu_id = ${menuId}
    GROUP BY md.id
    ORDER BY md.service_date
  `;

  const recipes = await sql`
    SELECT r.id, r.name, r.category, r.protein_group, r.seasons,
           np.fiber_g, np.sodium_mg, np.vitamin_d_mcg, np.vitamin_c_mg, np.calcium_mg
    FROM recipes r
    LEFT JOIN nutrition_profiles np ON np.recipe_id = r.id
    WHERE r.is_active = true
    ORDER BY r.category, r.name
  `;

  const conflicts = await sql`
    SELECT description, severity FROM conflicts
    WHERE menu_id = ${menuId} AND resolved = false
  `;

  const monthName = MONTH_NAMES[menu.month - 1];

  // Build current menu state as a compact table
  const menuStateLines = days
    .filter(d => !d.is_holiday)
    .map(d => {
      const date = new Date(d.service_date).toISOString().slice(0, 10);
      if (!d.items.length) return `  ${date}: (empty)`;
      const slots = d.items.map(i => `${i.meal_type}:[${i.recipe_id}]${i.recipe_name}`).join(' | ');
      return `  ${date}: ${slots}`;
    });

  const prompt = `You are a menu planning assistant for the St. Joseph County Commission on Aging meal program.

**Menu:** ${monthName} ${menu.year}
**Instruction from Nutrition Manager:** "${instruction}"

## Current Menu State
${menuStateLines.join('\n')}

## Unresolved Conflicts
${conflicts.length > 0 ? conflicts.map(c => `  [${c.severity}] ${c.description}`).join('\n') : '  None.'}

## Available Recipes
${buildRecipeContext(recipes)}

## OAA Conflict Rules
${CONFLICT_RULES_TEXT}

## OAA DRI Targets
${OAA_TARGETS_TEXT}

## Instructions
Interpret the Nutrition Manager's instruction and propose the minimal set of changes needed to fulfil it.
- Only use recipe IDs that exist in the Available Recipes list above.
- For 'remove' actions, include remove_recipe_id (the UUID of the item being removed).
- For 'replace' actions, include both remove_recipe_id and recipe_id/recipe_name.
- Respect all conflict rules. If a change would create a new conflict, fix it proactively.
- If the instruction is ambiguous, make the most reasonable interpretation.
- If the instruction cannot be fulfilled (e.g. no suitable recipe exists), return an empty changes array and explain in the summary.

Call submit_menu_edits with your proposed diff.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    tools: [MENU_EDIT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_menu_edits' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `# Recipe Database\n${buildRecipeContext(recipes)}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return menu edits');
  return toolUse.input; // { summary, changes: [...] }
}

// ── AI-Assisted USDA FDC Matching ────────────────────────────────────────────

const SELECT_FDC_TOOL = {
  name: 'select_best_fdc_match',
  description: 'Select the best USDA FoodData Central match for a food service ingredient. Call once.',
  input_schema: {
    type: 'object',
    properties: {
      fdc_id:  { type: 'number', description: 'The fdcId of the best matching food from the candidates list' },
      reason:  { type: 'string', description: 'One sentence explaining why this is the best match for institutional food service use' },
    },
    required: ['fdc_id', 'reason'],
  },
};

export async function selectBestFdcMatch({ ingredientName, recipeName, recipeCategory, candidates }) {
  const client = getClient();

  const candidateLines = candidates.map((c, i) =>
    `  ${i + 1}. [${c.fdcId}] ${c.description} (${c.dataType}${c.brandOwner ? ` — ${c.brandOwner}` : ''})`
  ).join('\n');

  const prompt = `You are selecting the best USDA FoodData Central match for a food service recipe ingredient.

Recipe: "${recipeName || 'Unknown'}" (${recipeCategory || 'Unknown category'})
Ingredient to match: "${ingredientName}"

USDA FoodData Central candidates:
${candidateLines}

Choose the best match for institutional quantity cooking. Prefer:
- SR Legacy or Foundation Foods data types over Survey (FNDDS) or Branded
- Generic/commodity items over brand-name products when appropriate
- Cooked or ready-to-serve forms for protein entrees (unless context clearly calls for raw)
- Standard packaged forms for pantry/shelf items

Call select_best_fdc_match with the fdcId of the best candidate and a one-sentence reason.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    tools: [SELECT_FDC_TOOL],
    tool_choice: { type: 'tool', name: 'select_best_fdc_match' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return an FDC selection');

  // Validate that the returned fdc_id exists in our candidate list
  const match = candidates.find(c => c.fdcId === toolUse.input.fdc_id);
  if (!match) {
    // Claude hallucinated an ID — fall back to first candidate
    return { fdcId: candidates[0].fdcId, description: candidates[0].description, reason: 'Best match by relevance score.' };
  }

  return { fdcId: match.fdcId, description: match.description, reason: toolUse.input.reason };
}

// ── Feedback Insights ─────────────────────────────────────────────────────────

const INSIGHTS_TOOL = {
  name: 'submit_feedback_insights',
  description: 'Submit AI-generated waste reduction and ordering recommendations based on client feedback data. Call once with all insights.',
  input_schema: {
    type: 'object',
    properties: {
      data_quality: {
        type: 'string',
        enum: ['sufficient', 'limited', 'insufficient'],
        description: 'sufficient = 3+ menus with 30+ ratings across 10+ recipes; limited = some data but may be thin; insufficient = too little to draw reliable conclusions',
      },
      data_note: {
        type: 'string',
        description: 'Short note about data limitations when quality is limited or insufficient. Omit when sufficient.',
      },
      insights: {
        type: 'array',
        description: 'Actionable insights ordered by impact (most important first). Maximum 10.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['retire', 'reduce', 'increase', 'celebrate', 'seasonal'],
              description: 'retire = consider removing from rotation (avg < 2.5, 3+ menus); reduce = order conservatively, expect low participation (avg 2.5–3.2); increase = popular, ensure sufficient quantity (avg ≥ 4.2); celebrate = exceptional favorite to feature (avg ≥ 4.5, 3+ menus); seasonal = performs significantly better in certain seasons',
            },
            recipe_id:       { type: 'string', description: 'UUID of the recipe this insight relates to' },
            recipe_name:     { type: 'string' },
            recommendation:  { type: 'string', description: 'One clear actionable sentence (e.g. "Reduce order quantity by ~20% or consider replacing with a higher-rated alternative.")' },
            supporting_data: { type: 'string', description: 'One concise sentence citing the specific numbers that support this insight' },
          },
          required: ['type', 'recipe_id', 'recipe_name', 'recommendation', 'supporting_data'],
        },
      },
    },
    required: ['data_quality', 'insights'],
  },
};

export async function generateFeedbackInsights(recipeStats, summary) {
  const client = getClient();

  const recipeLines = recipeStats.map(r => {
    const seasonStr = r.seasons?.length ? r.seasons.join(',') : 'all seasons';
    return `  [${r.recipe_id}] ${r.recipe_name} (${r.category}) | avg:${r.avg_rating} median:${Number(r.median_rating).toFixed(2)} | total:${r.total_ratings} low(≤2):${r.low_ratings} high(≥4):${r.high_ratings} | menus_served:${r.menus_served} | seasons:${seasonStr}`;
  }).join('\n');

  const prompt = `You are a waste-reduction and menu quality analyst for the St. Joseph County Commission on Aging congregate meal program.

## Feedback Data Summary
- Total menus with feedback: ${summary.total_menus}
- Total ratings collected: ${summary.total_ratings}
- Recipes with ≥3 ratings: ${recipeStats.length}

## Per-Recipe Statistics (recipes with ≥3 ratings, sorted avg low→high)
Format: [uuid] Name (Category) | avg | median | total low(≤2) high(≥4) | menus_served | seasons
${recipeLines || '  No recipes with sufficient data.'}

## Task
Analyze this feedback data and generate actionable insights to help the nutrition manager:
1. Reduce food waste — low-rated recipes drive lower participation → more waste
2. Optimize ordering quantities — high-rated recipes need sufficient stock
3. Improve menu quality — flag candidates to retire or celebrate
4. Leverage seasonal patterns — only if clearly supported by the data

## Thresholds
- retire:    avg < 2.5 across ≥3 menus — strong signal to replace
- reduce:    avg 2.5–3.2 — participation likely below estimates
- increase:  avg ≥ 4.2 — popular, ensure sufficient quantity
- celebrate: avg ≥ 4.5 across ≥3 menus — exceptional favorite, prioritize
- seasonal:  only if data clearly shows season-specific performance

## Rules
- Only cite recipe IDs from the list above
- Do NOT flag a recipe for both retire and celebrate
- Limit to ≤10 total insights — quality over quantity
- If data_quality is not sufficient (< 3 menus or < 30 ratings), set data_quality = "limited" and include a data_note
- If there is almost no data, set data_quality = "insufficient" and return empty insights array

Call submit_feedback_insights with your analysis.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    tools: [INSIGHTS_TOOL],
    tool_choice: { type: 'tool', name: 'submit_feedback_insights' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return feedback insights');
  return toolUse.input; // { data_quality, data_note?, insights: [...] }
}

export async function generateMenuProposal(menuId) {
  const client = getClient();

  // ── Load menu ──────────────────────────────────────────────────────────────
  const [menu] = await sql`SELECT * FROM menus WHERE id = ${menuId}`;
  if (!menu) throw new Error('Menu not found');
  if (menu.status !== 'DRAFT') throw new Error('Menu must be DRAFT to generate a proposal');

  // ── Load days with existing items ──────────────────────────────────────────
  const days = await sql`
    SELECT md.id, md.service_date, md.is_holiday,
           COALESCE(
             json_agg(
               json_build_object(
                 'recipe_id',   mdi.recipe_id,
                 'recipe_name', r.name,
                 'meal_type',   mdi.meal_type,
                 'category',    r.category
               ) ORDER BY mdi.sort_order
             ) FILTER (WHERE mdi.id IS NOT NULL),
             '[]'
           ) AS items
    FROM menu_days md
    LEFT JOIN menu_day_items mdi ON mdi.menu_day_id = md.id
    LEFT JOIN recipes r ON r.id = mdi.recipe_id
    WHERE md.menu_id = ${menuId}
    GROUP BY md.id
    ORDER BY md.service_date
  `;

  // ── Load active recipes with nutrition profiles ────────────────────────────
  const recipes = await sql`
    SELECT r.id, r.name, r.category, r.protein_group, r.seasons,
           np.fiber_g, np.sodium_mg, np.vitamin_d_mcg, np.vitamin_c_mg,
           np.calcium_mg
    FROM recipes r
    LEFT JOIN nutrition_profiles np ON np.recipe_id = r.id
    WHERE r.is_active = true
    ORDER BY r.category, r.name
  `;

  // ── Load client feedback ratings (≥3 responses only) ─────────────────────
  const ratings = await sql`
    SELECT mdi.recipe_id,
           ROUND(AVG(cf.rating)::numeric, 2) AS avg_rating,
           COUNT(*)::int                      AS count
    FROM client_feedback cf
    JOIN menu_day_items mdi ON mdi.id = cf.menu_day_item_id
    GROUP BY mdi.recipe_id
    HAVING COUNT(*) >= 3
  `;
  const ratingMap = Object.fromEntries(
    ratings.map(r => [r.recipe_id, { avg: Number(r.avg_rating), count: r.count }])
  );

  const season    = getSeason(menu.month);
  const monthName = MONTH_NAMES[menu.month - 1];
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const toISO = d => new Date(d.service_date).toISOString().slice(0, 10);
  const serviceDates = days
    .filter(d => !d.is_holiday)
    .map(d => new Date(d.service_date).toISOString().slice(0, 10));

  // ── Build prompt blocks ────────────────────────────────────────────────────
  // Block 1: stable recipe database — cached across repeated generation calls
  const recipeBlock = `# COA Menu Planner — Recipe Database\n\nThese are all active recipes available for menu planning.\n${buildRecipeContext(recipes, ratingMap)}`;

  // Block 2: dynamic context specific to this menu
  const existingLines = days
    .filter(d => !d.is_holiday && d.items.length > 0)
    .map(d => {
      const slots = d.items.map(i => `${i.meal_type}:${i.recipe_name}`).join(', ');
      return `  ${toISO(d)}: ${slots}`;
    });

  let dynamicBlock = `# Menu Generation Request

**Program:** St. Joseph County Commission on Aging — Congregate Meal Program
**Month:** ${monthName} ${menu.year}
**Current season:** ${season}
**Service dates (these are the ONLY valid dates — use exactly these, no others):**
${serviceDates.map(d => `  - ${d}`).join('\n')}

## OAA Title III-C Compliance Targets (per meal)
${OAA_TARGETS_TEXT}

## Conflict Rules
${CONFLICT_RULES_TEXT}

## Already Placed Items (do NOT suggest replacements for occupied slots)
${existingLines.length > 0 ? existingLines.join('\n') : '  None placed yet.'}
`;

  if (menu.planning_notes) {
    dynamicBlock += `\n## Vendor Constraints & Planning Notes\n${menu.planning_notes}\n`;
  }

  dynamicBlock += `
## Task
The COA serves meals Monday through Friday — ALL five days including Friday require a full menu.
For every service date listed above, suggest items to fill any empty slots. A complete day has:
  HOT (hot entree), COLD (cold entree), 1–2 SIDE, 1 FRUIT, 1 BREAD, 1 DESSERT (optional).

Guidelines:
- Suggest items for EVERY service date — do not skip or omit any day, including Fridays.
- Prefer ${season.toLowerCase()} recipes (seasons field) but do not restrict to them.
- Respect all three conflict rules strictly.
- Vary proteins across the month — avoid repeating the same protein group on consecutive days.
- Aim for DRI compliance across the month — flag high-sodium recipes and balance with low-sodium days.
- Only suggest recipes that exist in the recipe database (use exact recipe IDs).

Call submit_menu_proposal with your complete suggestion set.`;

  // ── Call Claude ────────────────────────────────────────────────────────────
  // A full month can be ~22 weekdays × up to 6 suggestions, each with a UUID,
  // name and reason sentence. 8000 tokens truncated the tool call and silently
  // produced an empty `days` array — generous headroom prevents that.
  // Stream the response: the SDK rejects non-streaming requests above its
  // token threshold (the >10-minute guard), so high max_tokens requires it.
  const stream = client.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 32000,
    tools: [SUBMIT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_menu_proposal' },
    messages: [{
      role: 'user',
      content: [
        // Recipe list cached — changes infrequently, large token block
        { type: 'text', text: recipeBlock, cache_control: { type: 'ephemeral' } },
        // Dynamic request context — not cached
        { type: 'text', text: dynamicBlock },
      ],
    }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The proposal response was cut off before completing (token limit reached). ' +
      'Try filling some days manually first, then regenerate the remaining slots.'
    );
  }

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('The assistant did not return a menu proposal — no tool call in response');

  const proposal = toolUse.input; // expected shape: { days: [{ service_date, suggestions: [...] }] }

  // Server-side diagnostic — visible in Cloud Run logs if the response shape
  // looks wrong. Strings have .length too, so the old !days?.length check let
  // malformed responses through and crashed the frontend with "x.every is not
  // a function" when ProposalPanel tried to iterate them.
  console.log('[generateMenuProposal] shape:', {
    stop_reason: response.stop_reason,
    days_type: typeof proposal?.days,
    is_array: Array.isArray(proposal?.days),
    days_count: Array.isArray(proposal?.days) ? proposal.days.length : null,
  });

  if (!proposal || !Array.isArray(proposal.days)) {
    throw new Error(
      'The assistant returned an unexpected proposal shape. Try again — if this persists, the model output may need a different prompt structure.'
    );
  }
  if (proposal.days.length === 0) {
    throw new Error(
      'The assistant returned no suggestions. This menu may already be complete, ' +
      'or no suitable recipes were found for the empty slots.'
    );
  }

  return proposal;
}

// ── Nutrition gap explainer ────────────────────────────────────────────────────

const EXPLAIN_TOOL = {
  name: 'submit_nutrition_explanations',
  description: 'Submit plain-English explanations and fix suggestions for each flagged nutrient gap.',
  input_schema: {
    type: 'object',
    properties: {
      explanations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nutrient:    { type: 'string', description: 'Nutrient key matching the input data (e.g. vitamin_d_mcg)' },
            explanation: { type: 'string', description: '2-3 sentences: what the gap is, which days drive it, and why it matters for older adults.' },
            suggestions: {
              type: 'array',
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  recipe_id:   { type: 'string',  description: 'UUID from the recipe database' },
                  recipe_name: { type: 'string' },
                  action:      { type: 'string',  description: 'Specific action, e.g. "Add as a SIDE on Monday 2026-06-02" or "Swap the HOT entree on Wednesday 2026-06-05"' },
                  reason:      { type: 'string',  description: 'One sentence: why this recipe helps fix the gap' },
                },
                required: ['recipe_id', 'recipe_name', 'action', 'reason'],
              },
            },
          },
          required: ['nutrient', 'explanation', 'suggestions'],
        },
      },
    },
    required: ['explanations'],
  },
};

// Nutrient columns in nutrition_profiles — used to validate dynamic queries.
const NP_COLUMNS = new Set([
  'calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
  'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg',
]);

// OAA target types — needed to determine fix-candidate sort direction.
const OAA_TARGET_TYPE = {
  calories_kcal: 'min', protein_g: 'min', fiber_g: 'min',
  sodium_mg:     'max',
  calcium_mg:    'min', vitamin_d_mcg: 'min', vitamin_c_mg: 'min', potassium_mg: 'min',
  sat_fat_pct:   'max', // computed — skipped in DB queries
};

export async function explainNutritionGaps(menuId) {
  const client = getClient();

  // ── Load menu ──────────────────────────────────────────────────────────────
  const [menu] = await sql`SELECT * FROM menus WHERE id = ${menuId}`;
  if (!menu) throw new Error('Menu not found');

  // ── Load days + items + profiles ───────────────────────────────────────────
  const days = await sql`
    SELECT id, service_date, is_holiday FROM menu_days
    WHERE menu_id = ${menuId} ORDER BY service_date
  `;

  const items = days.length > 0
    ? await sql`
        SELECT mdi.menu_day_id, mdi.recipe_id, mdi.meal_type, r.name AS recipe_name
        FROM menu_day_items mdi
        JOIN recipes r ON r.id = mdi.recipe_id
        WHERE mdi.menu_day_id = ANY(${days.map(d => d.id)})
        ORDER BY mdi.sort_order
      `
    : [];

  const recipeIds = [...new Set(items.map(i => i.recipe_id))];
  const profiles  = recipeIds.length > 0
    ? await sql`SELECT * FROM nutrition_profiles WHERE recipe_id = ANY(${recipeIds})`
    : [];
  const byRecipe = Object.fromEntries(profiles.map(p => [p.recipe_id, p]));

  const KEYS = ['calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
                'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg'];

  const itemsByDay = {};
  for (const item of items) (itemsByDay[item.menu_day_id] ??= []).push(item);

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function isoDate(serviceDate) {
    // service_date may come as a Date object or string
    return new Date(serviceDate).toISOString().slice(0, 10);
  }
  function dowLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }

  // Compute per-day totals for non-holiday days
  const dayResults = days
    .filter(d => !d.is_holiday)
    .map(day => {
      const dayItems = itemsByDay[day.id] ?? [];
      const totals   = Object.fromEntries(KEYS.map(k => [k, 0]));
      const recipeSlots = dayItems.map(i => `${i.meal_type}:${i.recipe_name}`);
      for (const item of dayItems) {
        const p = byRecipe[item.recipe_id];
        if (!p) continue;
        for (const k of KEYS) totals[k] += Number(p[k] ?? 0);
      }
      return { id: day.id, iso: isoDate(day.service_date), totals, recipeSlots };
    });

  // Monthly averages
  const activeDays = dayResults.filter(d => Object.values(d.totals).some(v => v > 0));
  if (activeDays.length === 0) {
    throw new Error('No nutrition data yet — add recipes with USDA links first.');
  }
  const avgTotals = Object.fromEntries(KEYS.map(k => [k, 0]));
  for (const d of activeDays) for (const k of KEYS) avgTotals[k] += d.totals[k];
  for (const k of KEYS) avgTotals[k] = Math.round((avgTotals[k] / activeDays.length) * 100) / 100;

  const compliance = checkDRICompliance(avgTotals);
  const flagged    = compliance.filter(r => r.status !== 'ok');
  if (flagged.length === 0) throw new Error('All nutrients are within OAA targets — nothing to explain.');

  // ── Build day-by-day breakdown for each flagged nutrient ───────────────────
  const dayBreakdownBlocks = flagged
    .filter(r => NP_COLUMNS.has(r.nutrient))  // skip sat_fat_pct
    .map(row => {
      const lines = dayResults.map(d => {
        const val = Math.round((d.totals[row.nutrient] ?? 0) * 10) / 10;
        const recipes = d.recipeSlots.length > 0 ? d.recipeSlots.join(', ') : 'no items';
        return `  ${d.iso} (${dowLabel(d.iso)}): ${val} ${row.unit} | ${recipes}`;
      });
      return `### Day-by-Day: ${row.label} (${row.targetType === 'min' ? `target ≥${row.target}` : `limit ≤${row.target}`} ${row.unit})\n${lines.join('\n')}`;
    });

  // ── Build fix-candidate blocks ─────────────────────────────────────────────
  const fixCandidateBlocks = [];
  for (const row of flagged) {
    if (!NP_COLUMNS.has(row.nutrient)) continue;  // sat_fat_pct computed, skip

    const col = row.nutrient;
    const isMin = OAA_TARGET_TYPE[col] === 'min';

    // For min gaps: show recipes highest in that nutrient (add them)
    // For max gaps: show recipes lowest in that nutrient (swap offenders with these)
    const candidates = isMin
      ? await sql`
          SELECT r.id, r.name, r.category, np.${sql(col)} AS val
          FROM nutrition_profiles np
          JOIN recipes r ON r.id = np.recipe_id
          WHERE r.is_active = true AND np.${sql(col)} > 0
          ORDER BY np.${sql(col)} DESC LIMIT 6
        `
      : await sql`
          SELECT r.id, r.name, r.category, np.${sql(col)} AS val
          FROM nutrition_profiles np
          JOIN recipes r ON r.id = np.recipe_id
          WHERE r.is_active = true AND np.${sql(col)} >= 0
          ORDER BY np.${sql(col)} ASC LIMIT 6
        `;

    const label = isMin ? `highest ${row.label} recipes (add or swap in)` : `lowest ${row.label} recipes (swap offenders with these)`;
    const lines = candidates.map(r =>
      `  - [${r.id}] ${r.name} (${r.category}): ${Math.round(Number(r.val) * 10) / 10} ${row.unit}`
    );
    fixCandidateBlocks.push(`### Fix Candidates — ${label}\n${lines.join('\n')}`);
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  const monthName = MONTH_NAMES[menu.month - 1];

  const prompt = `# OAA Nutrition Gap Analysis — ${monthName} ${menu.year}

You are helping a COA (Commission on Aging) nutrition manager understand and fix OAA Title III-C compliance gaps for a senior congregate meal program serving adults 70+.

## Monthly Average vs. OAA Targets (${activeDays.length} active service days)
${flagged.map(r =>
  `- **${r.label}**: ${r.actual} ${r.unit}  (OAA: ${r.targetType === 'min' ? '≥' : '≤'}${r.target} ${r.unit}) — ${r.status.toUpperCase()}`
).join('\n')}

## Day-by-Day Breakdown for Flagged Nutrients
${dayBreakdownBlocks.join('\n\n')}

## Available Fix Recipes from the Database
${fixCandidateBlocks.join('\n\n')}

## Instructions
For EACH flagged nutrient:
1. Write a 2-3 sentence plain-English explanation of the gap: what it is, which specific days are the worst, and why it matters for older adults.
2. Suggest 1-3 specific fixes using ONLY recipes from the fix-candidate lists above. For each suggestion, name the specific day (date + day-of-week) and meal slot (HOT/COLD/SIDE/FRUIT/BREAD) where adding or swapping that recipe would have the most impact.

Be concrete and specific. Use actual dates, recipe names, and nutrient values from the data above.

Call submit_nutrition_explanations with your analysis.`;

  // ── Call Claude ────────────────────────────────────────────────────────────
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [EXPLAIN_TOOL],
    tool_choice: { type: 'tool', name: 'submit_nutrition_explanations' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return explanations');

  console.log(`[explain] stop_reason=${response.stop_reason} gaps=${flagged.length} explanations=${toolUse.input?.explanations?.length ?? 0}`);

  // Validate recipe IDs — filter out any hallucinated UUIDs
  const allRecipeIds = await sql`SELECT id FROM recipes WHERE is_active = true`;
  const validIds = new Set(allRecipeIds.map(r => r.id));

  const validated = (toolUse.input?.explanations ?? []).map(exp => ({
    ...exp,
    suggestions: (exp.suggestions ?? []).filter(s => {
      const ok = validIds.has(s.recipe_id);
      if (!ok) console.warn(`[explain] Dropping hallucinated recipe_id ${s.recipe_id} in ${exp.nutrient}`);
      return ok;
    }),
  }));

  return { explanations: validated };
}
