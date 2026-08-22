import { Image } from "lucide-react";
import { buildRegistry, type FeatureModule } from "./registry";
const mk = (id: string, order: number, path = `/${id}`): FeatureModule => ({
  id,
  title: id,
  path,
  icon: Image,
  order,
  Page: () => null,
});
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
});
