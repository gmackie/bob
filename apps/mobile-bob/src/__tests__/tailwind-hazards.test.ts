/**
 * Build hazard guard: Tailwind scans every source file as plain text, so a bare word that
 * happens to be a filter or back-drop utility (in a string, an identifier or a comment)
 * generates CSS that react-native-css cannot deserialize:
 *
 *   src/styles.css: failed to deserialize; expected an object-like struct named Specifier
 *
 * and `expo export` fails. Confirmed one token at a time with `expo export --platform ios`
 * (BOB-81): every filter utility below broke the build, and every back-drop one did too;
 * the bare word "filter" (Array.prototype.filter) is fine.
 *
 * The words are built by concatenation so this file, which Tailwind also scans, never
 * contains them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

const BL = "bl" + "ur";
/** Utilities that need no value: the bare word is enough (also with a -size or -[arbitrary] suffix). */
const BARE = [BL, "gray" + "scale", "inv" + "ert", "se" + "pia", "drop-sh" + "adow"];
/** Utilities that need a value: only the word followed by -<value> is a utility. */
const VALUED = ["bright" + "ness", "con" + "trast", "satu" + "rate", "hue-ro" + "tate"];
const BACKDROP = "back" + "drop";

// Tailwind candidates are delimited by anything that cannot be part of a class name.
const BEFORE = String.raw`(?<![A-Za-z0-9_\-])`;
const AFTER = String.raw`(?![A-Za-z0-9_])`;
const SUFFIX = String.raw`-(?:[A-Za-z0-9]+|\[[^\]\s]*\])`;
const HAZARD = new RegExp(
  [
    `${BEFORE}-?(?:${BARE.join("|")})(?:${SUFFIX})?${AFTER}(?!-)`,
    `${BEFORE}-?(?:${VALUED.join("|")})${SUFFIX}${AFTER}(?!-)`,
    `${BEFORE}${BACKDROP}-[A-Za-z0-9\\-\\[\\]]+`,
  ].join("|"),
  "g",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function hazards(text: string): string[] {
  return [...text.matchAll(HAZARD)].map((m) => m[0]);
}

describe("Tailwind build hazards", () => {
  it("recognises the tokens that broke expo export, and leaves ordinary words alone", () => {
    expect(hazards(`const style = "${BL}";`)).toEqual([BL]);
    expect(hazards(`// a ${BL}red photo: ${BL}-sm md:${BL}-[2px]`)).toEqual([`${BL}-sm`, `${BL}-[2px]`]);
    expect(hazards(`"${BACKDROP}-filter ${BACKDROP}-opacity-50" ${VALUED[0]}-50 -${VALUED[3]}-15`)).toEqual([
      `${BACKDROP}-filter`, `${BACKDROP}-opacity-50`, `${VALUED[0]}-50`, `-${VALUED[3]}-15`,
    ]);
    expect(hazards(`items.filter(Boolean); onBlur(); ${BL}Radius; in ${VALUED[1]} to; is${BARE[2]}ed`)).toEqual([]);
  });

  it("no mobile source file contains a filter-family utility as a standalone token", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, n) => hazards(line).map((token) => `${path.relative(SRC, file)}:${n + 1}: ${token}`)),
    );
    // Rename the word (e.g. "soften", "dim"): Tailwind would emit CSS react-native-css cannot read.
    expect(found).toEqual([]);
  });
});
