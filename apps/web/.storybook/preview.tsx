import React from "react";
import type { Preview } from "@storybook/react";
import { withThemeByClassName } from "@storybook/addon-themes";

import "../src/app/styles.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "light",
      parentSelector: "html",
    }),
    (Story) => {
      // Wrap stories in a themed container so bg-background takes effect
      return (
        <div className="bg-background text-foreground min-h-[100px] p-6 font-sans antialiased">
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
