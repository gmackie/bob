const path = require("node:path");
const fs = require("node:fs");

const { compile } = require("react-native-css/compiler");

const reactNativeCssRoot = path.dirname(
  require.resolve("react-native-css/package.json"),
);
const { unstable_transformerPath } = require(require.resolve(
  "@expo/metro-config",
  { paths: [reactNativeCssRoot] },
));
const postcss = require(require.resolve("postcss", {
  paths: [path.dirname(require.resolve("@tailwindcss/postcss"))],
}));

const { getNativeInjectionCode } = require(path.join(
  reactNativeCssRoot,
  "dist/commonjs/metro/injection-code.js",
));

const worker = require(unstable_transformerPath);

function normalizeTailwindForReactNativeCss(css) {
  const root = postcss.parse(css);

  // Collect CSS custom property values from :root so we can inline them.
  const customProps = {};
  root.walkRules((rule) => {
    if (rule.selector.split(",").some((s) => s.trim() === ":root")) {
      rule.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) {
          customProps[decl.prop] = decl.value;
        }
      });
    }
  });

  root.walkAtRules("property", (rule) => {
    rule.remove();
  });

  // Remove all @layer wrappers — promote their children so react-native-css
  // doesn't have to understand cascade layers.
  root.walkAtRules("layer", (rule) => {
    const param = rule.params.trim();
    if (param === "properties") {
      rule.remove();
      return;
    }
    // Unwrap: replace @layer with its children in-place
    rule.replaceWith(...rule.nodes);
  });

  root.walkAtRules("supports", (rule) => {
    rule.remove();
  });

  root.walkAtRules("media", (rule) => {
    if (["ios", "android"].includes(rule.params.trim())) {
      rule.remove();
    }
  });

  // Remove :root/:host rules — custom properties are already inlined.
  root.walkRules((rule) => {
    if (rule.selector.split(",").every((s) => {
      const trimmed = s.trim();
      return trimmed === ":root" || trimmed === ":host";
    })) {
      rule.remove();
      return;
    }

    if (
      /^\.space-[xy]-/.test(rule.selector) ||
      /^:where\(\.space-[xy]-/.test(rule.selector) ||
      rule.selector === ".filter" ||
      rule.selector === ".transform"
    ) {
      rule.remove();
      return;
    }
  });

  root.walkDecls((decl) => {
    if (decl.value.includes("calc(infinity * 1px)")) {
      decl.value = decl.value.replaceAll("calc(infinity * 1px)", "9999px");
    }

    if (decl.value.includes("3.40282e38px")) {
      decl.value = decl.value.replaceAll("3.40282e38px", "9999px");
    }

    if (decl.value.includes("var(--tw-border-style)")) {
      decl.value = decl.value.replaceAll("var(--tw-border-style)", "solid");
    }

    if (decl.value.includes("var(--tw-leading,")) {
      decl.value = decl.value.replace(
        /var\(--tw-leading,\s*(var\(--text-[^)]+\))\)/g,
        "$1",
      );
    }

    // Remove declarations with lab()/oklch()/oklab() colors that
    // react-native-css cannot parse.
    if (/\b(?:lab|oklch|oklab)\(/.test(decl.value)) {
      decl.remove();
      return;
    }

    // Inline CSS custom properties that react-native-css cannot resolve.
    // Resolves var(--prop) and var(--prop, fallback) references using
    // values collected from :root.
    if (decl.value.includes("var(--")) {
      decl.value = decl.value.replace(
        /var\((--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\)/g,
        (match, prop, fallback) => {
          if (customProps[prop]) return customProps[prop];
          if (fallback) return fallback.trim();
          return match;
        },
      );
    }
  });

  return root.toString();
}

async function transform(config, projectRoot, filePath, data, options) {
  const isCss = options.type !== "asset" && /\.(s?css|sass)$/.test(filePath) && !filePath.includes(".module.");
  if (options.platform === "web" || !isCss) {
    return worker.transform(config, projectRoot, filePath, data, options);
  }

  const cssFile = await worker.transform(config, projectRoot, filePath, data, {
    ...options,
    platform: "web",
  });
  const css = normalizeTailwindForReactNativeCss(
    cssFile.output[0].data.css.code.toString(),
  );
  if (process.env.DEBUG_NATIVE_CSS_TRANSFORMER) {
    fs.writeFileSync("/tmp/mobile-bob-native-css.css", css);
  }
  const productionJS = compile(css, {
    ...options.reactNativeCSS,
    filename: filePath,
    projectRoot,
  }).stylesheet();

  data = Buffer.from(getNativeInjectionCode([], [productionJS]));
  const transformResult = await worker.transform(
    config,
    projectRoot,
    `${filePath}.js`,
    data,
    options,
  );

  transformResult.output[0].data.css = {
    skipCache: true,
    code: "",
  };
  return transformResult;
}

module.exports = { transform };
