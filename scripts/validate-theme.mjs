#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");
const file = args.find((arg) => !arg.startsWith("-")) ?? "themes/claude.json";
const themePath = path.resolve(file);

const requiredLeaves = [
  "categorical",
  "text.base",
  "text.muted",
  "text.faint",
  "text.action.primary.base",
  "text.action.primary.$disabled",
  "text.action.primary.$focused",
  "text.action.primary.$selected",
  "text.action.secondary.base",
  "text.action.secondary.$hovered",
  "text.action.secondary.$focused",
  "text.action.destructive.base",
  "text.action.destructive.$disabled",
  "text.formfield.base",
  "text.formfield.$hovered",
  "text.formfield.$focused",
  "text.formfield.$pressed",
  "text.formfield.$disabled",
  "text.formfield.$selected",
  "text.feedback.error.base",
  "text.feedback.warning.base",
  "text.feedback.success.base",
  "text.feedback.info.base",
  "background.base",
  "background.raised.base",
  "background.raised.high",
  "background.raised.max",
  "background.action.primary.base",
  "background.action.primary.$hovered",
  "background.action.primary.$focused",
  "background.action.primary.$selected",
  "background.action.secondary.base",
  "background.action.destructive.base",
  "background.formfield.base",
  "background.feedback.error.base",
  "background.feedback.warning.base",
  "background.feedback.success.base",
  "background.feedback.info.base",
  "border.base",
  "scrollbar.base",
  "diff.text.added",
  "diff.text.removed",
  "diff.text.context",
  "diff.text.hunkHeader",
  "diff.background.added",
  "diff.background.removed",
  "diff.background.context",
  "diff.highlight.added",
  "diff.highlight.removed",
  "diff.lineNumber.text",
  "diff.lineNumber.background.added",
  "diff.lineNumber.background.removed",
  "syntax.comment",
  "syntax.keyword",
  "syntax.function",
  "syntax.variable",
  "syntax.string",
  "syntax.number",
  "syntax.type",
  "syntax.operator",
  "syntax.punctuation",
  "markdown.text",
  "markdown.heading",
  "markdown.link",
  "markdown.linkText",
  "markdown.code",
  "markdown.blockQuote",
  "markdown.emphasis",
  "markdown.strong",
  "markdown.horizontalRule",
  "markdown.listItem",
  "markdown.listEnumeration",
  "markdown.image",
  "markdown.imageText",
  "markdown.codeBlock",
  "@dialog.background.base",
  "@dialog.background.action.primary.$hovered",
  "@dialog.background.action.secondary.$hovered",
];

const hueNames = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "accent", "interactive", "neutral"];
const steps = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const surfaces = ["background.base", "background.raised.base", "background.raised.high", "background.raised.max", "@dialog.background.base"];
const formfieldSurfaces = [...surfaces, "background.formfield.base"];

const errors = [];
let checks = 0;

function fail(message) {
  errors.push(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function leafPaths(value, prefix = "") {
  if (!isObject(value)) return [prefix];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    paths.push(...leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

function getPath(value, keyPath) {
  return keyPath.split(".").reduce((current, key) => (isObject(current) ? current[key] : undefined), value);
}

function merge(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (isObject(value) && isObject(result[key])) result[key] = merge(result[key], value);
    else result[key] = structuredClone(value);
  }
  return result;
}

function buildTree(mode) {
  const tree = structuredClone(theme);
  const overrides = Object.fromEntries(Object.entries(theme[mode] ?? {}).filter(([key]) => key !== "hue"));
  tree.base = merge(theme.base, overrides);
  return tree;
}

function resolveColor(value, tree, mode, trail = []) {
  if (value === "transparent") return value;
  if (typeof value !== "string") throw new Error(`Color no válido: ${JSON.stringify(value)}`);
  if (!value.startsWith("$")) {
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
      throw new Error(`Color no válido: ${value}`);
    }
    return value;
  }

  if (trail.includes(value)) throw new Error(`Referencia circular: ${[...trail, value].join(" -> ")}`);

  if (value.startsWith("$hue.")) {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error(`Referencia de hue inválida: ${value}`);
    const [, hueName, step] = parts;
    if (!steps.includes(step)) throw new Error(`Paso de hue inválido "${step}" en ${value}`);
    let hue = tree[mode]?.hue?.[hueName];
    if (hue === undefined) throw new Error(`Hue inexistente "${hueName}" en modo ${mode}`);

    const seen = new Set();
    while (typeof hue === "string") {
      if (!hue.startsWith("$hue.")) throw new Error(`Alias de hue inválido "${hueName}": ${hue}`);
      if (seen.has(hue)) throw new Error(`Alias de hue circular: ${[...seen, hue].join(" -> ")}`);
      seen.add(hue);
      const aliasParts = hue.split(".");
      if (aliasParts.length !== 2) throw new Error(`Alias de hue inválido "${hueName}": ${hue}`);
      const target = aliasParts[1];
      hue = tree[mode]?.hue?.[target];
      if (hue === undefined) throw new Error(`Alias "${hueName}" apunta a un hue inexistente "${target}"`);
    }

    const color = hue?.[step];
    if (typeof color !== "string") throw new Error(`Hue "${hueName}.${step}" no tiene color en modo ${mode}`);
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
      throw new Error(`Color inválido en "${hueName}.${step}": ${color}`);
    }
    return color;
  }

  const targetPath = value.slice(1);
  const target = getPath(tree.base, targetPath);
  if (target === undefined) throw new Error(`Referencia sin resolver: ${value} en modo ${mode}`);
  if (isObject(target)) throw new Error(`La referencia ${value} apunta a un objeto en modo ${mode}`);
  return resolveColor(target, tree, mode, [...trail, value]);
}

function validateHueAlias(mode, name, palette, seen = new Set()) {
  const target = palette[name];
  if (typeof target !== "string") return target;
  if (!target.startsWith("$hue.")) {
    fail(`Alias de hue inválido en ${mode}.${name}: ${target}`);
    return undefined;
  }
  const parts = target.split(".");
  if (parts.length !== 2) {
    fail(`Alias de hue inválido en ${mode}.${name}: ${target} (no se permiten pasos en un alias)`);
    return undefined;
  }
  const targetName = parts[1];
  if (!hueNames.includes(targetName)) {
    fail(`Alias de hue ${mode}.${name} apunta a un hue desconocido: ${targetName}`);
    return undefined;
  }
  if (seen.has(targetName)) {
    fail(`Alias de hue circular en ${mode}.${name}: ${[...seen, targetName].join(" -> ")}`);
    return undefined;
  }
  seen.add(targetName);
  const next = palette[targetName];
  if (next === undefined) {
    fail(`Alias de hue ${mode}.${name} apunta a un hue inexistente: ${targetName}`);
    return undefined;
  }
  return typeof next === "string" ? validateHueAlias(mode, targetName, palette, seen) : next;
}

function isOpaqueHex(value) {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function toRgb(hex) {
  let value = hex.slice(1);
  if (value.length === 4 || value.length === 8) {
    throw new Error(`Color con alpha no soportado en contraste: ${hex}`);
  }
  if (value.length === 3) {
    value = value
      .split("")
      .map((character) => character + character)
      .join("");
  } else if (value.length !== 6) {
    throw new Error(`Color no válido para contraste: ${hex}`);
  }
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

let theme;
try {
  theme = JSON.parse(fs.readFileSync(themePath, "utf8").replace(/^\uFEFF/, ""));
} catch (error) {
  console.error(`No se pudo leer ${themePath}: ${error.message}`);
  process.exit(1);
}

if (!isObject(theme)) {
  console.error(`El tema debe ser un objeto JSON: ${path.relative(process.cwd(), themePath)}`);
  process.exit(1);
}

if (!isObject(theme.base)) fail("Falta la sección base");

const providedLeaves = new Set(leafPaths(theme.base ?? {}));
for (const leaf of requiredLeaves) {
  if (!providedLeaves.has(leaf)) fail(`Falta el token base: ${leaf}`);
}

if (!Array.isArray(theme.base?.categorical)) {
  fail("base.categorical debe ser un array de nombres de hue");
} else {
  if (theme.base.categorical.length === 0) fail("base.categorical no puede estar vacío");
  for (const name of theme.base.categorical) {
    if (typeof name !== "string" || !hueNames.includes(name)) {
      fail(`base.categorical contiene un hue desconocido: ${name}`);
    }
  }
}

const modes = ["dark", "light"].filter((mode) => isObject(theme[mode]));
if (!modes.length) fail("El tema debe definir al menos dark o light");

for (const mode of modes) {
  const palette = theme[mode].hue;
  for (const name of hueNames) {
    const hue = palette?.[name];
    if (hue === undefined) {
      fail(`Falta el hue "${name}" en modo ${mode}`);
      continue;
    }
    if (typeof hue === "string") {
      validateHueAlias(mode, name, palette);
      continue;
    }
    if (!isObject(hue)) {
      fail(`El hue "${name}" no es un objeto en modo ${mode}`);
      continue;
    }
    for (const key of Object.keys(hue)) {
      if (!steps.includes(key)) fail(`Paso de hue desconocido en ${mode}.${name}: ${key}`);
    }
    for (const step of steps) {
      const color = hue[step];
      if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color ?? "")) {
        fail(`Color inválido ${mode}.${name}.${step}: ${color}`);
      } else if (!isOpaqueHex(color)) {
        fail(`Color con alpha no soportado en ${mode}.${name}.${step}: ${color}`);
      }
    }
    if (steps.every((step) => isOpaqueHex(hue[step]))) {
      const luminances = steps.map((step) => luminance(hue[step]));
      for (let index = 1; index < luminances.length; index += 1) {
        const delta = luminances[index] - luminances[index - 1];
        if (Math.abs(delta) < 0.005) fail(`Hue ${mode}.${name}: pasos ${steps[index - 1]} y ${steps[index]} demasiado próximos`);
        if (mode === "dark" && delta > 0) fail(`Hue ${mode}.${name}: la escala se aclara en ${steps[index]}`);
        if (mode === "light" && delta < 0) fail(`Hue ${mode}.${name}: la escala se oscurece en ${steps[index]}`);
      }
    }
  }

  let tree;
  try {
    tree = buildTree(mode);
  } catch (error) {
    fail(`No se pudo construir el tema ${mode}: ${error.message}`);
    continue;
  }

  for (const leaf of leafPaths(tree.base)) {
    const value = getPath(tree.base, leaf);
    if (typeof value !== "string") continue;
    try {
      resolveColor(value, tree, mode);
    } catch (error) {
      fail(`${mode}.${leaf}: ${error.message}`);
    }
  }

  const asColor = (value) => {
    if (typeof value !== "string") return value;
    if (value === "transparent" || value.startsWith("#") || value.startsWith("$")) return value;
    return getPath(tree.base, value);
  };

  const checkPair = (foreground, background, minimum, label) => {
    checks += 1;
    let backgroundValue = asColor(background);
    if (backgroundValue === "transparent") backgroundValue = "$background.base";
    try {
      const foregroundValue = asColor(foreground);
      if (foregroundValue === undefined || backgroundValue === undefined) {
        fail(`${mode} ${label}: token inexistente`);
        return;
      }
      const fg = resolveColor(foregroundValue, tree, mode);
      const bg = resolveColor(backgroundValue, tree, mode);
      if (fg === "transparent" || bg === "transparent") return;
      const ratio = contrast(fg, bg);
      if (ratio < minimum) fail(`${mode} ${label}: ${ratio.toFixed(2)} < ${minimum} (${fg} sobre ${bg})`);
      else if (verbose) console.log(`ok ${mode} ${label} = ${ratio.toFixed(2)}`);
    } catch (error) {
      fail(`${mode} ${label}: ${error.message}`);
    }
  };

  for (const action of ["primary", "secondary", "destructive"]) {
    for (const state of ["base", "$hovered", "$focused", "$pressed", "$selected", "$disabled"]) {
      const text = getPath(tree.base, `text.action.${action}.${state}`) ?? getPath(tree.base, `text.action.${action}.base`);
      const background = getPath(tree.base, `background.action.${action}.${state}`) ?? getPath(tree.base, `background.action.${action}.base`);
      let transparent = false;
      try {
        transparent = resolveColor(background, tree, mode) === "transparent";
      } catch {
        // checkPair reporta el token inexistente o la referencia rota.
      }
      if (transparent) {
        for (const surface of surfaces) {
          checkPair(text, surface, state === "$disabled" ? 3 : 4.5, `action.${action}.${state} sobre ${surface}`);
        }
      } else {
        checkPair(text, background, state === "$disabled" ? 3 : 4.5, `action.${action}.${state}`);
      }
    }
  }

  for (const state of ["base", "$hovered", "$focused", "$pressed", "$selected", "$disabled"]) {
    const text = getPath(tree.base, `text.formfield.${state}`) ?? getPath(tree.base, "text.formfield.base");
    for (const surface of formfieldSurfaces) {
      checkPair(text, surface, state === "$disabled" ? 3 : 4.5, `formfield.${state} sobre ${surface}`);
    }
  }

  for (const kind of ["error", "warning", "success", "info"]) {
    for (const surface of [...surfaces, `background.feedback.${kind}.base`]) {
      checkPair(`text.feedback.${kind}.base`, surface, 4.5, `feedback.${kind} sobre ${surface}`);
    }
  }

  const surfacedTokens = [
    "text.base",
    "text.muted",
    "text.faint",
    ...Object.keys(tree.base.syntax ?? {}).map((key) => `syntax.${key}`),
    ...Object.keys(tree.base.markdown ?? {})
      .filter((key) => key !== "horizontalRule")
      .map((key) => `markdown.${key}`),
  ];
  for (const surface of surfaces) {
    for (const token of surfacedTokens) {
      checkPair(token, surface, 4.5, `${token} sobre ${surface}`);
    }
  }

  checkPair("diff.text.added", "diff.background.added", 4.5, "diff added");
  checkPair("diff.text.removed", "diff.background.removed", 4.5, "diff removed");
  checkPair("diff.text.context", "diff.background.context", 4.5, "diff context");
  checkPair("diff.text.hunkHeader", "diff.background.context", 4.5, "diff hunk header");
  checkPair("diff.highlight.added", "diff.background.added", 4.5, "diff highlight added");
  checkPair("diff.highlight.removed", "diff.background.removed", 4.5, "diff highlight removed");
  checkPair("diff.lineNumber.text", "diff.lineNumber.background.added", 4.5, "diff line number added");
  checkPair("diff.lineNumber.text", "diff.lineNumber.background.removed", 4.5, "diff line number removed");
  checkPair("diff.lineNumber.text", "diff.background.context", 4.5, "diff line number context");

  for (const token of ["border.base", "scrollbar.base"]) {
    for (const surface of surfaces) {
      checkPair(token, surface, 3, `${token} sobre ${surface}`);
    }
  }

  if (getPath(tree.base, "text.action.primary.$hovered") !== undefined) {
    checkPair("text.action.primary.$hovered", "@dialog.background.action.primary.$hovered", 4.5, "dialog primary hover");
  }
  if (getPath(tree.base, "text.action.secondary.$hovered") !== undefined) {
    checkPair("text.action.secondary.$hovered", "@dialog.background.action.secondary.$hovered", 4.5, "dialog secondary hover");
  }
}

if (errors.length) {
  console.error(`\n${errors.length} problema(s) en ${path.relative(process.cwd(), themePath)}:`);
  for (const error of [...new Set(errors)]) console.error(` - ${error}`);
  process.exit(1);
}

console.log(
  `Theme OK: ${requiredLeaves.length} tokens base, modos ${modes.join(" + ")}, ${checks} comprobaciones de contraste.`,
);
