import { describe, expect, it } from "vitest";
import { renderTemplate, templateVarsFromDate } from "./renderTemplate";

describe("templateVarsFromDate", () => {
  it("derives zero-padded date parts from a UTC date", () => {
    const vars = templateVarsFromDate(new Date(Date.UTC(2024, 5, 15, 14, 3, 21)), "IMG_4821", "cr2");
    expect(vars).toEqual({
      yyyy: "2024",
      mm: "06",
      dd: "15",
      HH: "14",
      MM: "03",
      SS: "21",
      q: "2",
      stem: "IMG_4821",
      ext: "cr2",
    });
  });

  it("computes the quarter from the month", () => {
    expect(templateVarsFromDate(new Date(Date.UTC(2024, 0, 1)), "s", "e").q).toBe("1");
    expect(templateVarsFromDate(new Date(Date.UTC(2024, 3, 1)), "s", "e").q).toBe("2");
    expect(templateVarsFromDate(new Date(Date.UTC(2024, 8, 1)), "s", "e").q).toBe("3");
    expect(templateVarsFromDate(new Date(Date.UTC(2024, 11, 1)), "s", "e").q).toBe("4");
  });
});

describe("renderTemplate", () => {
  const vars = templateVarsFromDate(new Date(Date.UTC(2024, 5, 15, 14, 3, 21)), "IMG_4821", "cr2");

  it("interpolates known variables", () => {
    expect(renderTemplate("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}", vars)).toBe("2024-06-15_IMG_4821");
  });

  it("interpolates a folder template with a literal slash", () => {
    expect(renderTemplate("{{yyyy}}/Q{{q}}", vars)).toBe("2024/Q2");
  });

  it("leaves an unknown variable untouched", () => {
    expect(renderTemplate("{{nope}}", vars)).toBe("{{nope}}");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{ yyyy }}", vars)).toBe("2024");
  });

  it("passes through plain text with no tokens", () => {
    expect(renderTemplate("static", vars)).toBe("static");
  });
});
