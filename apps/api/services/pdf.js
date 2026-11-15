import PDFDocument from 'pdfkit';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// postgres.js returns DATE columns as JS Date objects; normalize to YYYY-MM-DD string.
function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Group menu days into Mon–Fri week rows for the calendar grid.
function buildWeekRows(days) {
  if (!days.length) return [];
  const byDate = Object.fromEntries(days.map(d => [toDateStr(d.service_date), d]));
  const sorted = [...days].sort((a, b) => (toDateStr(a.service_date) > toDateStr(b.service_date) ? 1 : -1));

  const first = new Date(toDateStr(sorted[0].service_date) + 'T12:00:00Z');
  const last  = new Date(toDateStr(sorted[sorted.length - 1].service_date) + 'T12:00:00Z');

  // Roll back to Monday of the first week
  const startDow = first.getUTCDay(); // 1=Mon ... 5=Fri
  const weekStart = new Date(first);
  weekStart.setUTCDate(weekStart.getUTCDate() - (startDow - 1));

  const rows = [];
  const cur = new Date(weekStart);
  while (cur <= last) {
    const row = [];
    for (let i = 0; i < 5; i++) {
      const iso = cur.toISOString().slice(0, 10);
      row.push(byDate[iso] ?? null); // null = day not in this month
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    cur.setUTCDate(cur.getUTCDate() + 2); // skip weekend
    rows.push(row);
  }
  return rows;
}

// Streams a monthly menu calendar PDF to `res`.
export function generateMenuPdf(menu, res) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="coa-menu-${menu.year}-${String(menu.month).padStart(2, '0')}.pdf"`);
  doc.pipe(res);

  const PW = 792, PH = 612;
  const ML = 36, MR = 36, MT = 30, MB = 24;
  const usableW = PW - ML - MR;
  const COA_BLUE = '#003366';
  const CELL_BG  = '#f0f5fb';

  // Header height: taller if narrative present
  const narrativeText = menu.client_narrative?.trim() ?? '';
  const HEADER_BG_H = narrativeText ? MT + 80 : MT + 60;

  // Header block
  doc.rect(0, 0, PW, HEADER_BG_H).fill(COA_BLUE);

  doc.fillColor('white')
     .font('Helvetica-Bold').fontSize(18)
     .text('HOT MENU', ML, MT, { width: usableW / 3 });

  doc.font('Helvetica-Bold').fontSize(18)
     .text(`${MONTH_NAMES[menu.month]} ${menu.year}`, ML + usableW / 3, MT,
           { width: usableW / 3, align: 'center' });

  doc.font('Helvetica').fontSize(9)
     .text('St. Joseph County Commission on Aging', ML + (2 * usableW) / 3, MT,
           { width: usableW / 3, align: 'right' })
     .text('(269) 467-6144', ML + (2 * usableW) / 3, MT + 14,
           { width: usableW / 3, align: 'right' });

  // Narrative subtitle (if present)
  if (narrativeText) {
    doc.fillColor('white').font('Helvetica').fontSize(8)
       .text(narrativeText, ML, MT + 44, {
         width: usableW,
         align: 'center',
         lineGap: 1,
       });
  }

  // Day-of-week headers
  const headerY = HEADER_BG_H;
  const HEADER_H = 20;
  const colW = usableW / 5;

  doc.fillColor(COA_BLUE);
  for (let i = 0; i < 5; i++) {
    const x = ML + i * colW;
    doc.rect(x, headerY, colW, HEADER_H).fill(COA_BLUE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
       .text(DAY_LABELS[i], x, headerY + 5, { width: colW, align: 'center' });
    doc.fillColor(COA_BLUE);
  }

  // Calendar grid
  const gridY  = headerY + HEADER_H;
  const gridH  = PH - gridY - MB;
  const rows   = buildWeekRows(menu.days);
  const rowH   = rows.length > 0 ? Math.floor(gridH / rows.length) : gridH;

  for (let r = 0; r < rows.length; r++) {
    const y = gridY + r * rowH;
    for (let c = 0; c < 5; c++) {
      const x = ML + c * colW;
      const day = rows[r][c];

      // Cell background
      doc.rect(x, y, colW, rowH).fillAndStroke(CELL_BG, '#cccccc');

      if (!day) continue;

      const dateNum = new Date(toDateStr(day.service_date) + 'T12:00:00Z').getUTCDate();
      const PADDING = 4;

      // Date number (top-right)
      doc.fillColor(COA_BLUE).font('Helvetica-Bold').fontSize(10)
         .text(String(dateNum), x + colW - 24, y + PADDING, { width: 20, align: 'right' });

      if (day.is_holiday) {
        doc.fillColor('#888888').font('Helvetica-Oblique').fontSize(8)
           .text(day.holiday_note ?? 'Holiday', x + PADDING, y + PADDING + 12,
                 { width: colW - PADDING * 2 });
        continue;
      }

      // Items
      const items = (day.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
      let textY = y + PADDING + 12;

      for (const item of items) {
        if (textY > y + rowH - 10) break;
        const isHot  = item.meal_type === 'HOT';
        const isCold = item.meal_type === 'COLD';
        // Color coding: HOT=black bold, COLD=COA blue, sides/fruit/bread=dark green, dessert=purple
        const color = isHot ? '#111111'
          : isCold ? '#1a4a7a'
          : item.meal_type === 'DESSERT' ? '#5b21b6'
          : '#166534'; // SIDE, FRUIT, BREAD

        doc.fillColor(color)
           .font(isHot ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(isHot ? 8 : 7);

        const name = item.recipe_name ?? 'Unknown';
        doc.text(name, x + PADDING, textY, {
          width: colW - PADDING * 2,
          lineBreak: false,
          ellipsis: true,
        });
        textY += (isHot ? 10 : 9);
      }
    }
  }

  // Outer border
  doc.rect(ML, gridY, usableW, rows.length * rowH).stroke('#aaaaaa');

  doc.end();
}

// Streams a weekly ingredient order list PDF to `res`.
export function generateOrderListPdf(data, label, res) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: 0, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  const filename = `order-list-${data.menu_year}-${String(data.menu_month).padStart(2,'0')}-week${data.week}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const PW = 612, PH = 792;
  const ML = 40, MR = 40, MT = 30;
  const usableW = PW - ML - MR;
  const COA_BLUE = '#003366';
  const HEADER_H = MT + 50;

  // Header
  doc.rect(0, 0, PW, HEADER_H).fill(COA_BLUE);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(14)
     .text('INGREDIENT ORDER LIST', ML, MT, { width: usableW * 0.6 });
  doc.fillColor('white').font('Helvetica').fontSize(10)
     .text(label, ML, MT + 18, { width: usableW * 0.6 });
  doc.fillColor('white').font('Helvetica').fontSize(8)
     .text('St. Joseph County Commission on Aging', ML + usableW * 0.6, MT, { width: usableW * 0.4, align: 'right' })
     .text(`Default: ${data.default_servings} servings/day`, ML + usableW * 0.6, MT + 12, { width: usableW * 0.4, align: 'right' })
     .text(`Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`, ML + usableW * 0.6, MT + 24, { width: usableW * 0.4, align: 'right' });

  let y = HEADER_H + 12;

  const drawSection = (title, items, bg) => {
    if (items.length === 0) return;

    // Section header
    doc.rect(ML, y, usableW, 16).fill(bg);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
       .text(title, ML + 6, y + 3, { width: usableW - 12 });
    y += 18;

    // Column headers
    doc.fillColor('#444444').font('Helvetica-Bold').fontSize(8);
    doc.text('Ingredient', ML + 4, y, { width: 160 });
    doc.text('Qty', ML + 168, y, { width: 50, align: 'right' });
    doc.text('Unit', ML + 222, y, { width: 50 });
    doc.text('Product Code', ML + 276, y, { width: 80 });
    doc.text('Case Size', ML + 360, y, { width: 80 });
    doc.text('Recipes', ML + 444, y, { width: usableW - 444, lineBreak: false });
    y += 12;
    doc.moveTo(ML, y).lineTo(ML + usableW, y).strokeColor('#cccccc').stroke();
    y += 3;

    for (const item of items) {
      if (y > PH - 60) {
        doc.addPage();
        y = 40;
      }
      const rowBg = items.indexOf(item) % 2 === 0 ? '#f7f9fc' : '#ffffff';
      const rowH = 12;
      doc.rect(ML, y - 1, usableW, rowH).fill(rowBg);

      const color = item.vendor ? '#111111' : '#b45309'; // amber for untagged
      doc.fillColor(color).font('Helvetica').fontSize(7.5);
      doc.text(item.ingredient_name, ML + 4, y, { width: 160, lineBreak: false, ellipsis: true });
      doc.text(String(item.total_quantity), ML + 168, y, { width: 50, align: 'right', lineBreak: false });
      doc.text(item.unit, ML + 222, y, { width: 50, lineBreak: false, ellipsis: true });
      doc.text(item.gfs_product_code ?? '—', ML + 276, y, { width: 80, lineBreak: false, ellipsis: true });
      doc.text(item.case_size ?? '—', ML + 360, y, { width: 80, lineBreak: false, ellipsis: true });
      doc.fillColor('#555555');
      doc.text(item.recipes.join(', '), ML + 444, y, { width: usableW - 450, lineBreak: false, ellipsis: true });
      y += rowH;
    }
    y += 10;
  };

  drawSection('GFS ITEMS', data.gfs_items, '#1e40af');
  drawSection('OTHER VENDOR ITEMS', data.other_items, '#065f46');
  if (data.untagged_items.length > 0) {
    drawSection(`UNTAGGED — NEEDS VENDOR ASSIGNMENT (${data.untagged_items.length})`, data.untagged_items, '#92400e');
  }

  // Footer
  const footerY = PH - 30;
  doc.moveTo(ML, footerY).lineTo(ML + usableW, footerY).strokeColor('#cccccc').stroke();
  doc.fillColor('#888888').font('Helvetica').fontSize(7)
     .text('ST. JOSEPH COUNTY COMMISSION ON AGING — CONFIDENTIAL', ML, footerY + 6, { width: usableW, align: 'center' });

  doc.end();
}

// Streams a production recipe card PDF to `res`.
export function generateRecipeCardPdf(recipe, ingredients, res) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: 0, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="recipe-${recipe.id}.pdf"`);
  doc.pipe(res);

  const PW = 612, PH = 792;
  const ML = 48, MR = 48, MT = 36;
  const usableW = PW - ML - MR;
  const COA_BLUE = '#003366';

  // Header
  doc.rect(0, 0, PW, MT + 50).fill(COA_BLUE);

  doc.fillColor('white').font('Helvetica-Bold').fontSize(16)
     .text(recipe.name, ML, MT, { width: usableW });
  doc.fillColor('#aaccee').font('Helvetica').fontSize(10)
     .text(recipe.category?.replace('_', ' ') ?? '', ML, MT + 22, { width: usableW });

  let y = MT + 60;

  // Info table
  const infoItems = [
    ['Yield',           `${recipe.base_servings} servings`],
    ['Serving Utensil', recipe.serving_utensil ?? '—'],
    ['Serving Size',    recipe.serving_size_oz ? `${recipe.serving_size_oz} oz` : '—'],
    ['Cooking Temp',    recipe.cooking_temp_f  ? `${recipe.cooking_temp_f}°F`   : '—'],
    ['Internal Temp',   recipe.internal_temp_f ? `${recipe.internal_temp_f}°F`  : '—'],
  ];

  const infoColW = usableW / 2;
  doc.rect(ML, y, usableW, 14 * infoItems.length + 8).fill('#f0f5fb');
  doc.rect(ML, y, usableW, 14 * infoItems.length + 8).stroke('#cccccc');

  for (let i = 0; i < infoItems.length; i++) {
    const iy = y + 4 + i * 14;
    doc.fillColor('#444444').font('Helvetica-Bold').fontSize(8)
       .text(infoItems[i][0], ML + 8, iy, { width: infoColW / 2 });
    doc.font('Helvetica').fontSize(8)
       .text(infoItems[i][1], ML + infoColW / 2, iy, { width: infoColW });
  }
  y += 14 * infoItems.length + 16;

  // Ingredients
  doc.fillColor(COA_BLUE).font('Helvetica-Bold').fontSize(11)
     .text('Ingredients', ML, y);
  y += 16;

  const colW = (usableW - 12) / 2;
  const half = Math.ceil(ingredients.length / 2);
  const leftIng  = ingredients.slice(0, half);
  const rightIng = ingredients.slice(half);

  const renderIngList = (list, x) => {
    let iy = y;
    for (const ing of list) {
      const qty = Number(ing.quantity_per_100_svgs);
      const label = `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)} ${ing.unit}  ${ing.ingredient_name}`;
      doc.fillColor('#222222').font('Helvetica').fontSize(8.5)
         .text(label, x, iy, { width: colW });
      iy += 12;
    }
    return iy;
  };

  const leftBottom  = renderIngList(leftIng,  ML);
  const rightBottom = renderIngList(rightIng, ML + colW + 12);
  y = Math.max(leftBottom, rightBottom) + 12;

  // Instructions
  if (recipe.instructions) {
    doc.fillColor(COA_BLUE).font('Helvetica-Bold').fontSize(11)
       .text('Instructions', ML, y);
    y += 16;

    const steps = recipe.instructions.split('\n').filter(s => s.trim());
    for (let i = 0; i < steps.length; i++) {
      const stepText = steps[i].trim();
      const isCCP = /\bCCP\b/i.test(stepText);
      doc.fillColor('#111111')
         .font(isCCP ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(8.5)
         .text(`${i + 1}. ${stepText}`, ML, y, { width: usableW });
      y += doc.currentLineHeight(true) + 4;
    }
  }

  // Footer
  const footerY = PH - 36;
  doc.moveTo(ML, footerY).lineTo(ML + usableW, footerY).stroke('#cccccc');
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  doc.fillColor('#666666').font('Helvetica').fontSize(8)
     .text(`Report Date: ${today}`, ML, footerY + 6, { width: usableW / 2 })
     .text('ST. JOSEPH COUNTY COMM ON AGING', ML, footerY + 6,
           { width: usableW, align: 'center' })
     .text('Page 1', ML, footerY + 6, { width: usableW, align: 'right' });

  doc.end();
}
