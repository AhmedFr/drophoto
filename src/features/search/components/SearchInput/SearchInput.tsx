import type { SearchInputProps } from "./SearchInput.types";

export function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus
      placeholder="Search file names, tags, cameras…"
      aria-label="Search"
      className="w-full border-b border-border bg-transparent px-5 py-3 font-mono text-[13px] outline-none placeholder:text-faint"
    />
  );
}
