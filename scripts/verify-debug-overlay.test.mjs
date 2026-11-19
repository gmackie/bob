import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guards the GMA-772 debug overlay fix.
 *
 * gstack's ios-qa bridge draws a sweeping border over the app in Debug builds.
 * The upstream template animates a SwiftUI AngularGradient's angle forever,
 * which re-shades a screen-sized gradient on the CPU every frame: a full core
 * on an iPad simulator for as long as the app runs. Bob's copy spins a Core
 * Animation conic gradient in the render server instead.
 *
 * The fix is not upstream, so `/ios-sync` (which copies the bridge files from
 * the installed gstack templates) can silently bring the old border back. This
 * check fails when that happens. Re-apply the patch kept at
 * ~/.gstack/local-patches/debug-overlay-cpu.patch, then regenerate.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_ROOTS = ["apps"];
const SKIP_DIRS = new Set(["node_modules", "Pods", "build", "DerivedData", ".build", ".expo"]);

function findOverlays(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        findOverlays(join(dir, entry.name), found);
      }
    } else if (entry.name === "DebugOverlay.swift") {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/** Swift source with comments and string literals blanked out. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** Returns the reasons an overlay source would burn CPU; empty when it is fine. */
export function overlayProblems(source) {
  const code = codeOnly(source);
  const problems = [];
  if (/\bAngularGradient\s*\(/.test(code)) {
    problems.push("draws the border with a SwiftUI AngularGradient (re-shaded on the CPU every frame when animated)");
  }
  if (/\.repeatForever\s*\(/.test(code)) {
    problems.push("runs a SwiftUI repeatForever animation, which re-renders the overlay every frame");
  }
  if (!/CABasicAnimation\s*\(\s*keyPath:\s*""\s*\)/.test(code) || !source.includes('"transform.rotation.z"')) {
    problems.push("no longer spins the border with a Core Animation transform.rotation.z animation");
  }
  return problems;
}

test("every DebugOverlay.swift spins its border in Core Animation", () => {
  const overlays = SEARCH_ROOTS.flatMap((root) => findOverlays(join(repoRoot, root)));
  assert.ok(overlays.length > 0, "expected at least one DebugOverlay.swift under apps/");
  for (const file of overlays) {
    const problems = overlayProblems(readFileSync(file, "utf8"));
    assert.deepEqual(
      problems,
      [],
      `${relative(repoRoot, file)} ${problems.join("; ")}. ` +
        "A gstack /ios-sync probably restored the upstream template: re-apply the GMA-772 fix.",
    );
  }
});

test("the check rejects the upstream AngularGradient border", () => {
  const upstream = `
    private struct OverlayRoot: View {
        @State private var phase: CGFloat = 0
        var body: some View {
            BorderShape()
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [.clear, .blue, .clear]),
                        center: .center,
                        angle: .degrees(phase * 360)
                    ),
                    lineWidth: 4
                )
                .onAppear {
                    withAnimation(.linear(duration: 2.0).repeatForever(autoreverses: false)) {
                        phase = 1.0
                    }
                }
        }
    }`;
  assert.equal(overlayProblems(upstream).length, 3);
});

test("comments that mention AngularGradient do not trip the check", () => {
  const fixed = `
    /// Animating an AngularGradient's angle in SwiftUI re-shades the screen.
    final class AnimatedBorderView: UIView {
        override func didMoveToWindow() {
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.repeatCount = .infinity // not .repeatForever(...)
        }
    }`;
  assert.deepEqual(overlayProblems(fixed), []);
});
