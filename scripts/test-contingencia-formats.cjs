const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_JS_PATH = path.join(ROOT_DIR, "apps", "api", "public", "app.js");
const FORMATS_DIR = path.join(ROOT_DIR, "fomato de factura");
const OUTPUT_DIR = path.join(ROOT_DIR, "tmp", "contingencia-format-tests");
const DEFAULT_REPORT_FILES = [
  "crpFacturaGRD.rpt",
  "crpFacturaPEQ.rpt",
  "crpFacturaPEQ (1).rpt",
  "crpFacturaPEQ (2).rpt",
];

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
}

function normalizeReportFileName(fileName) {
  return String(fileName || "").trim();
}

function sortReportFiles(left, right) {
  const leftIndex = DEFAULT_REPORT_FILES.findIndex((item) => item.toLowerCase() === left.toLowerCase());
  const rightIndex = DEFAULT_REPORT_FILES.findIndex((item) => item.toLowerCase() === right.toLowerCase());

  if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  if (leftIndex >= 0) {
    return -1;
  }

  if (rightIndex >= 0) {
    return 1;
  }

  return left.localeCompare(right, "es", { numeric: true, sensitivity: "base" });
}

function resolveReportFormats() {
  let files = [];
  if (fs.existsSync(FORMATS_DIR)) {
    files = fs.readdirSync(FORMATS_DIR)
      .filter((fileName) => path.extname(fileName).toLowerCase() === ".rpt")
      .map((fileName) => normalizeReportFileName(fileName))
      .filter(Boolean);
  }

  if (!files.length) {
    files = DEFAULT_REPORT_FILES.slice();
  }

  const uniqueFiles = [...new Set(files)].sort(sortReportFiles);
  return uniqueFiles.map((fileName, index) => ({
    id: index + 1,
    fileName,
    label: fileName,
  }));
}

function createBrowserContext() {
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  const previewWindowStub = {
    document: {
      open() {},
      write() {},
      close() {},
    },
    focus() {},
    print() {},
  };

  const documentStub = {
    addEventListener(type, callback) {
      if (type === "DOMContentLoaded") {
        this.__rockyDOMContentLoaded = callback;
      }
    },
    removeEventListener() {},
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return {
        style: {},
        classList: {
          add() {},
          remove() {},
        },
        appendChild() {},
        remove() {},
      };
    },
    body: {
      appendChild() {},
    },
  };

  const locationStub = {
    pathname: "/",
    search: "",
    hash: "",
    href: "http://127.0.0.1:3000/",
  };

  const windowStub = {
    sessionStorage,
    localStorage,
    rockyClient: null,
    location: locationStub,
    navigator: {
      userAgent: "RockyMaxxFormatTest",
    },
    document: documentStub,
    open() {
      return previewWindowStub;
    },
    setTimeout,
    clearTimeout,
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Map,
    Set,
    RegExp,
    Promise,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    URLSearchParams,
    fetch: async () => {
      throw new Error("fetch disabled in contingency format test harness");
    },
    document: documentStub,
    navigator: windowStub.navigator,
    location: locationStub,
    window: windowStub,
    globalThis: null,
    global: null,
  };

  context.globalThis = context;
  context.global = context;
  windowStub.window = windowStub;
  return context;
}

function loadFrontendContext() {
  const source = fs.readFileSync(APP_JS_PATH, "utf8");
  const context = createBrowserContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: APP_JS_PATH });
  return context;
}

function sha1(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function extractSignatureChecks(html) {
  const source = String(html || "");
  return {
    hasA5Page: source.includes('@page { size: A5 portrait; margin: 8mm; }'),
    has58mmPage: source.includes('@page { size: 58mm auto; margin: 2mm; }'),
    has72mmPage: source.includes('@page { size: 72mm auto; margin: 2.5mm; }'),
    has80mmCompactPage: source.includes('@page { size: 80mm auto; margin: 2.5mm; }'),
    hasTimesNewRoman: source.includes('font-family: "Times New Roman", serif;'),
    hasArial: source.includes('font-family: Arial, sans-serif;'),
    hasVerdana: source.includes('font-family: Verdana, sans-serif;'),
    hasTrebuchet: source.includes('font-family: "Trebuchet MS", sans-serif;'),
    hasContingenciaTag: source.includes('EMISION DE CONTINGENCIA'),
    hasTestFormatNote: source.includes('Formato de prueba:'),
  };
}

function resolveExpectedSignature(variant) {
  switch (variant) {
    case "grd":
      return "hasA5Page";
    case "peq":
      return "has58mmPage";
    case "peq-1":
      return "has72mmPage";
    case "peq-2":
      return "has80mmCompactPage";
    default:
      return "hasContingenciaTag";
  }
}

function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportFormats = resolveReportFormats();
  const context = loadFrontendContext();

  vm.runInContext(
    `
      state.impresoras.metadata = ${JSON.stringify({
        defaults: {
          id: 1,
          status: 1,
          idProcesoImpresion: 1,
        },
        reportFormats,
      })};
      state.desktopPrinting.items = [{ name: "DP8UBT-16", displayName: "DP8UBT-16", isDefault: true }];
      state.desktopPrinting.loaded = true;
    `,
    context,
  );

  const results = [];
  for (const reportFormat of reportFormats) {
    const evaluation = vm.runInContext(
      `
        (() => {
          const payload = buildImpresoraFormatoContingenciaPreviewPayload({
            nombreImpresora: "DP8UBT-16",
            idProcesoImpresion: ${JSON.stringify(String(reportFormat.id))},
          });
          const html = buildFacturacionInvoiceHtml(payload.venta, payload.draft, payload.paymentRows, payload.summary);
          return {
            html,
            fileName: payload.reportFormat.fileName,
            variant: resolveFacturacionInvoiceTemplateVariant(payload.venta),
          };
        })()
      `,
      context,
    );

    const baseName = path.basename(reportFormat.fileName, ".rpt").replace(/[^\w.-]+/g, "_");
    const htmlPath = path.join(OUTPUT_DIR, `${baseName}.html`);
    fs.writeFileSync(htmlPath, evaluation.html, "utf8");

    const checks = extractSignatureChecks(evaluation.html);
    const expectedSignature = resolveExpectedSignature(evaluation.variant);
    results.push({
      fileName: evaluation.fileName,
      variant: evaluation.variant,
      htmlPath,
      htmlSha1: sha1(evaluation.html),
      htmlBytes: Buffer.byteLength(evaluation.html, "utf8"),
      expectedSignature,
      signatureMatched: Boolean(checks[expectedSignature]),
      checks,
    });
  }

  const summaryPath = path.join(OUTPUT_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    formats: results,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    outputDir: OUTPUT_DIR,
    summaryPath,
    formats: results,
  }, null, 2));
}

run();
