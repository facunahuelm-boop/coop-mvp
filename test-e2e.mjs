import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const shots = "/tmp/shots";
import fs from "node:fs";
if (!fs.existsSync(shots)) fs.mkdirSync(shots);

// Si PLAYWRIGHT_EXECUTABLE_PATH está definida (por ejemplo, en un entorno con
// Chromium preinstalado en otra ruta), se usa esa. Si no, Playwright usa el
// Chromium que instala `npx playwright install chromium`.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const errors = [];

async function testUser(email, label, shotName, checks) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile viewport
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[${label}] console: ${msg.text()}`); });

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "cooperativa2026");
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 10000 }), page.click('button[type="submit"]')]);
  await page.screenshot({ path: `${shots}/${shotName}-dashboard.png` });

  if (checks) await checks(page, label, shotName);
  await ctx.close();
}

try {
  await testUser("helena@coop.uy", "Consejo Directivo", "01-consejo", async (page, label, shotName) => {
    for (const path of ["/obra", "/trabajo", "/compras", "/seguridad", "/finanzas", "/documentos", "/alertas", "/auditoria", "/ia"]) {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      if (!resp || resp.status() >= 400) errors.push(`[${label}] ${path} -> status ${resp?.status()}`);
      await page.screenshot({ path: `${shots}/${shotName}-${path.replace("/", "")}.png` });
    }
    // open first tarea de obra
    await page.goto(`${BASE}/obra`, { waitUntil: "networkidle" });
    const link = page.locator('a[href^="/obra/"]').first();
    if (await link.count()) {
      await Promise.all([page.waitForURL(/\/obra\/\d+/, { timeout: 8000 }), link.click()]);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${shotName}-obra-detalle.png` });
    }
    // compras detail
    await page.goto(`${BASE}/compras`, { waitUntil: "networkidle" });
    const clink = page.locator('a[href^="/compras/"]').first();
    if (await clink.count()) {
      await Promise.all([page.waitForURL(/\/compras\/\d+/, { timeout: 8000 }), clink.click()]);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${shotName}-compras-detalle.png` });
    }
    // IA chat: click a suggested question
    await page.goto(`${BASE}/ia`);
    const chip = page.locator("button", { hasText: "¿Cómo viene la obra?" });
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/${shotName}-ia-respuesta.png` });
      const bodyText = await page.textContent("body");
      if (!bodyText.includes("obra tiene")) errors.push(`[${label}] IA local no respondió como se esperaba`);
    } else {
      errors.push(`[${label}] no se encontró el chip de pregunta sugerida en /ia`);
    }
  });

  await testUser("ana@coop.uy", "Socio", "02-socio", async (page, label, shotName) => {
    // socio should NOT see compras/finanzas edit but dashboard should load fine
    await page.goto(`${BASE}/trabajo`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${shots}/${shotName}-trabajo.png` });
  });

  await testUser("beatriz@coop.uy", "Comision Obra", "03-obra", async (page, label, shotName) => {
    await page.goto(`${BASE}/obra`, { waitUntil: "networkidle" });
    // try creating a task via the form
    const details = page.locator("details", { hasText: "Agregar tarea" });
    await details.locator("summary").click();
    await page.fill('input[name="etapa"]', "Prueba E2E");
    await page.fill('input[name="nombre"]', "Tarea de prueba automática");
    await page.click('button:has-text("Crear tarea")');
    await page.waitForSelector("text=Tarea de prueba automática", { timeout: 8000 }).catch(() => {});
    const body = await page.textContent("body");
    if (!body.includes("Tarea de prueba automática")) errors.push(`[${label}] la tarea creada no aparece en el listado`);
    await page.screenshot({ path: `${shots}/${shotName}-obra-nueva-tarea.png` });
  });

  await testUser("diana@coop.uy", "Comision Compras", "04-compras", async (page, label, shotName) => {
    await page.goto(`${BASE}/compras`, { waitUntil: "networkidle" });
    const link = page.locator('a[href^="/compras/"]', { hasText: "Hierro" });
    if (await link.count()) {
      await Promise.all([page.waitForURL(/\/compras\/\d+/, { timeout: 8000 }), link.click()]);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${shotName}-comparacion.png` });
      const body = await page.textContent("body");
      if (!body.includes("más barato")) errors.push(`[${label}] la comparación de presupuestos no generó texto esperado`);
    }
  });
} catch (e) {
  errors.push(`EXCEPTION: ${e.message}`);
}

await browser.close();

if (errors.length) {
  console.log("ERRORS FOUND:");
  errors.forEach((e) => console.log(" - " + e));
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
}
