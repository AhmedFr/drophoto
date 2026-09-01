import { severityForCode, styleForLevel } from "./severity";

it("maps db to critical, red", () => {
  const s = severityForCode("db");
  expect(s.level).toBe("critical");
  expect(s.label).toBe("critical");
  expect(s.textClass).toBe("text-red-400");
  expect(s.dotClass).toBe("bg-red-400");
});

it("maps io to error, orange", () => {
  const s = severityForCode("io");
  expect(s.level).toBe("error");
  expect(s.textClass).toBe("text-orange-400");
  expect(s.dotClass).toBe("bg-orange-400");
});

it("maps not_found to error, orange", () => {
  const s = severityForCode("not_found");
  expect(s.level).toBe("error");
  expect(s.textClass).toBe("text-orange-400");
});

it("maps sidecar to warning, yellow", () => {
  const s = severityForCode("sidecar");
  expect(s.level).toBe("warning");
  expect(s.textClass).toBe("text-yellow-400");
  expect(s.dotClass).toBe("bg-yellow-400");
});

it("maps unsupported to info, faint", () => {
  const s = severityForCode("unsupported");
  expect(s.level).toBe("info");
  expect(s.textClass).toBe("text-faint");
  expect(s.dotClass).toBe("bg-faint");
});

it("falls back an unrecognized code to error", () => {
  const s = severityForCode("mystery");
  expect(s.level).toBe("error");
  expect(s.textClass).toBe("text-orange-400");
});

it("styleForLevel matches severityForCode's style for that level", () => {
  expect(styleForLevel("critical")).toEqual({
    label: "critical",
    textClass: "text-red-400",
    dotClass: "bg-red-400",
  });
  expect(styleForLevel("info")).toEqual({ label: "info", textClass: "text-faint", dotClass: "bg-faint" });
});
