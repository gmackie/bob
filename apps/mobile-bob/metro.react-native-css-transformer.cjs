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

  root.walkAtRules("property", (rule) => {
    rule.remove();
  });

  root.walkAtRules("layer", (rule) => {
    if (rule.params.trim() === "properties") {
      rule.remove();
    }
  });

  root.walkAtRules("supports", (rule) => {
    rule.remove();
  });

  root.walkAtRules("media", (rule) => {
    if (["ios", "android"].includes(rule.params.trim())) {
      rule.remove();
    }
  });

  root.walkRules((rule) => {
    if (
      /^\.space-[xy]-/.test(rule.selector) ||
      /^:where\(\.space-[xy]-/.test(rule.selector) ||
      rule.selector === ".filter" ||
      rule.selector === ".transform"
    ) {
      rule.remove();
      return;
    }

    const containsPlatformFontVars = rule.nodes?.some(
      (node) =>
        node.type === "atrule" &&
        node.name === "media" &&
        ["ios", "android"].includes(node.params.trim()),
    );
    if (rule.selector === ":root" && containsPlatformFontVars) {
      rule.remove();
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
  });

  return root.toString();
}

async function transform(config, projectRoot, filePath, data, options) {
  const isCss = options.type !== "asset" && /\.(s?css|sass)$/.test(filePath);
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
