import { Image } from "lucide-react";
import { buildRegistry, type FeatureModule, type FeatureRoute } from "./registry";
const mk = (id: string, order: number, path = `/${id}`, children?: FeatureRoute[]): FeatureModule => ({
  id,
  title: id,
  path,
  icon: Image,
  order,
  Page: () => null,
  children,
});
const mkChild = (id: string, path: string): FeatureRoute => ({ id, title: id, path, Page: () => null });
describe("buildRegistry", () => {
  it("sorts by order", () => {
    expect(buildRegistry([mk("b", 2), mk("a", 1)]).map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("throws on duplicate id", () => {
    expect(() => buildRegistry([mk("a", 1), mk("a", 2, "/x")])).toThrow(/duplicate feature id/);
  });
  it("throws on duplicate path", () => {
    expect(() => buildRegistry([mk("a", 1, "/p"), mk("b", 2, "/p")])).toThrow(
      /duplicate feature path/,
    );
  });

  it("keeps the flat case working when a module has no children", () => {
    expect(buildRegistry([mk("a", 1)]).map((m) => m.id)).toEqual(["a"]);
  });

  it("allows a child whose path equals its own parent's path (the index/default child)", () => {
    const settings = mk("settings", 1, "/settings", [mkChild("settings-general", "/settings")]);
    expect(() => buildRegistry([settings])).not.toThrow();
  });

  it("throws when two children of the same module share a path", () => {
    const settings = mk("settings", 1, "/settings", [
      mkChild("settings-library", "/settings/library"),
      mkChild("settings-library-2", "/settings/library"),
    ]);
    expect(() => buildRegistry([settings])).toThrow(/duplicate feature path: \/settings\/library/);
  });

  it("throws when a child's id collides with another module's id", () => {
    const settings = mk("settings", 1, "/settings", [mkChild("tags", "/settings/library")]);
    expect(() => buildRegistry([settings, mk("tags", 2)])).toThrow(/duplicate feature id: tags/);
  });

  it("throws when a child's path collides with a top-level module's path", () => {
    const settings = mk("settings", 1, "/settings", [mkChild("settings-tags", "/tags")]);
    expect(() => buildRegistry([settings, mk("tags", 2, "/tags")])).toThrow(
      /duplicate feature path: \/tags/,
    );
  });
});
