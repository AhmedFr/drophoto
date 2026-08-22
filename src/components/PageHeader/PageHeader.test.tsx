import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
it("renders uppercase title and right slot", () => {
  render(
    <PageHeader title="Gallery">
      <button>x</button>
    </PageHeader>,
  );
  expect(screen.getByRole("heading")).toHaveTextContent("GALLERY");
  expect(screen.getByRole("button")).toBeInTheDocument();
});
