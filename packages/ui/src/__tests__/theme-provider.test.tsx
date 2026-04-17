import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../theme-provider";

function ThemeConsumer() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("bob")}>Switch</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("provides default theme", () => {
    render(
      <ThemeProvider defaultTheme="ooda">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("ooda");
  });

  it("switches themes", () => {
    render(
      <ThemeProvider defaultTheme="ooda">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("Switch"));
    expect(screen.getByTestId("theme").textContent).toBe("bob");
  });
});
