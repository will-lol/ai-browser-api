import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

interface SearchInputProps {
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

export function SearchInput({
  ariaLabel,
  onChange,
  placeholder,
  value,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="w-full border-b border-border">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-none border-0 bg-secondary/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:bg-secondary/60"
          aria-label={ariaLabel}
        />
      </div>
    </div>
  );
}
