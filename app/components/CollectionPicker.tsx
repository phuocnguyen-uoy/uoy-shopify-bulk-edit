import { useCallback, useEffect, useRef, useState } from "react";

interface Collection {
  id: string;
  title: string;
  handle: string;
}

interface Props {
  name: string;
  label?: string;
  defaultValue?: string;
  hint?: string;
  onChange?: (ids: string) => void;
}

export function CollectionPicker({ name, label, defaultValue = "", hint, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Collection[]>([]);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  const fetchCollections = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ query });
      const res = await fetch(`/app/api/collections?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = (await res.json()) as { collections: Collection[] };
      setOptions(data.collections ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load selected collections by ID on mount (for prefill / copy-task)
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    const ids = defaultValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    fetch(`/app/api/collections?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((data: { collections: Collection[] }) => {
        setSelected(data.collections ?? []);
      })
      .catch(() => {});
  }, [defaultValue]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCollections(value), 300);
  };

  const openDropdown = () => {
    if (isOpen) return;
    // Use fixed positioning so the dropdown escapes any overflow:hidden ancestor
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        zIndex: 99999,
      });
    }
    setIsOpen(true);
    fetchCollections(search);
  };

  const toggle = (collection: Collection) => {
    const next = selected.some((c) => c.id === collection.id)
      ? selected.filter((c) => c.id !== collection.id)
      : [...selected, collection];
    setSelected(next);
    onChange?.(next.map((c) => c.id).join(","));
  };

  const removeSelected = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = selected.filter((c) => c.id !== id);
    setSelected(next);
    onChange?.(next.map((c) => c.id).join(","));
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const dropdown = document.getElementById("collection-picker-dropdown");
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !(dropdown && dropdown.contains(e.target as Node))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keep dropdown aligned on scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownStyle((prev) => ({
          ...prev,
          top: rect.bottom + 2,
          left: rect.left,
          width: rect.width,
        }));
      }
    };
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  const selectedIds = new Set(selected.map((c) => c.id));
  const hiddenValue = selected.map((c) => c.id).join(",");

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {label && (
        <div
          style={{
            fontSize: "14px",
            fontWeight: 500,
            marginBottom: "4px",
            color: "#202223",
          }}
        >
          {label}
        </div>
      )}

      <input type="hidden" name={name} value={hiddenValue} />

      {/* Combined tag + search input box */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          openDropdown();
          inputRef.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDropdown();
            inputRef.current?.focus();
          }
        }}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "4px",
          padding: "4px 8px",
          minHeight: "36px",
          border: `1px solid ${isOpen ? "#005bd3" : "#8c9196"}`,
          borderRadius: isOpen ? "6px 6px 0 0" : "6px",
          background: "#ffffff",
          cursor: "text",
          boxSizing: "border-box",
          outline: isOpen ? "2px solid #005bd3" : "none",
          outlineOffset: "1px",
        }}
      >
        {/* Chips for selected collections — inside the box */}
        {selected.map((c) => (
          <span
            key={c.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "2px",
              background: "#f1f2f3",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              padding: "1px 4px 1px 8px",
              fontSize: "13px",
              color: "#202223",
              lineHeight: "20px",
              flexShrink: 0,
            }}
          >
            {c.title}
            <button
              type="button"
              onClick={(e) => removeSelected(c.id, e)}
              aria-label={`Remove ${c.title}`}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
                padding: "0 2px",
                color: "#6d7175",
                display: "flex",
                alignItems: "center",
              }}
            >
              ×
            </button>
          </span>
        ))}

        {/* Inline search input */}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={openDropdown}
          placeholder={selected.length > 0 ? "" : "Search collections…"}
          autoComplete="off"
          style={{
            border: "none",
            outline: "none",
            flex: "1 1 80px",
            minWidth: "80px",
            fontSize: "14px",
            fontFamily: "inherit",
            background: "transparent",
            color: "#202223",
            padding: "2px 0",
          }}
        />
      </div>

      {/* Dropdown — fixed position to escape overflow:hidden */}
      {isOpen && (
        <div
          id="collection-picker-dropdown"
          style={{
            background: "#fff",
            border: "1px solid #8c9196",
            borderRadius: "0 0 6px 6px",
            maxHeight: "280px",
            overflowY: "auto",
            boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
            ...dropdownStyle,
          }}
        >
          {loading ? (
            <div style={{ padding: "12px 16px", color: "#6d7175", fontSize: "13px" }}>
              Loading…
            </div>
          ) : options.length === 0 ? (
            <div style={{ padding: "12px 16px", color: "#6d7175", fontSize: "13px" }}>
              {search ? "No collections found" : "No collections available"}
            </div>
          ) : (
            options.map((c) => {
              const checked = selectedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 14px",
                    cursor: "pointer",
                    background: checked ? "#f0f0f5" : "#fff",
                    userSelect: "none",
                    borderBottom: "1px solid #f1f2f3",
                  }}
                >
                  <input
                    id={"collection-option-" + c.id.replace(/\W/g, "-")}
                    type="checkbox"
                    aria-label={"Select " + c.title}
                    checked={checked}
                    onChange={() => toggle(c)}
                    style={{ margin: 0, flexShrink: 0, cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontSize: "14px", color: "#202223" }}>{c.title}</div>
                    <div style={{ fontSize: "12px", color: "#6d7175" }}>/{c.handle}</div>
                  </div>
                </div>
              );
            })
          )}
          {selected.length > 0 && (
            <div
              style={{
                padding: "8px 14px",
                borderTop: "1px solid #e4e5e7",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "12px", color: "#6d7175" }}>
                {selected.length} selected
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setSelected([]); onChange?.(""); }}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "#d72c0d",
                  padding: 0,
                }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {hint && (
        <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
