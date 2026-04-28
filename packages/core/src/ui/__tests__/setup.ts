import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

// Note: We explicitly call `expect.extend` rather than relying on the
// `@testing-library/jest-dom/vitest` side-effect entry point. With vitest
// `globals: true` the auto-injected global `expect` is registered in a way
// that the side-effect import does not consistently extend (the registration
// happens before the global proxy points at it), leaving matchers like
// `toBeDisabled` reported as "Invalid Chai property". Calling
// `expect.extend(matchers)` directly attaches them to vitest's `expect` and
// the global proxy picks them up correctly.
expect.extend(matchers);
