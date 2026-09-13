import { useId } from "react";
export type SelectOption = { value: string; label: string; hint?: string };
type Props = {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  placeholder?: string; disabled?: boolean; className?: string; size?: "sm" | "md";
  label?: string; id?: string; name?: string;
};
/** Single project select adapter. Native keyboard/typeahead/mobile semantics. */
export default function Select({ value, onChange, options, placeholder, disabled, className = "", size = "md", label, id, name }: Props) {
  const generatedId = useId();
  return <select id={id ?? generatedId} name={name} value={value} onChange={event => onChange(event.target.value)} disabled={disabled || options.length === 0}
    aria-label={label ?? placeholder ?? "选择选项"} className={`input min-w-0 ${size === "sm" ? "text-sm" : ""} ${className}`}>
    {!options.some(option => option.value === value) && <option value="" disabled>{placeholder ?? "请选择"}</option>}
    {options.map(option => <option key={option.value} value={option.value}>{option.label}{option.hint ? ` · ${option.hint}` : ""}</option>)}
  </select>;
}
