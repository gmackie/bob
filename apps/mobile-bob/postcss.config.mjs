import tailwindcss from "@tailwindcss/postcss";

const normalizeTailwindForReactNativeCss = {
  postcssPlugin: "normalize-tailwind-for-react-native-css",
  OnceExit(root) {
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
  },
};

export default {
  plugins: [tailwindcss(), normalizeTailwindForReactNativeCss],
};
