import { useEffect, useRef } from "react";
import type { Instance } from "flatpickr/dist/types/instance";

interface Props {
  name: string;
  label?: string;
  defaultValue?: string;
  includeTime?: boolean;
  required?: boolean;
  hint?: string;
}

export function DatePicker({
  name,
  label,
  defaultValue,
  includeTime = false,
  required,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fpRef = useRef<Instance | null>(null);

  useEffect(() => {
    let destroyed = false;
    import("flatpickr").then(({ default: flatpickr }) => {
      if (destroyed || !inputRef.current) return;
      fpRef.current = flatpickr(inputRef.current, {
        dateFormat: includeTime ? "Y/m/d H:i" : "Y/m/d",
        enableTime: includeTime,
        time_24hr: true,
        allowInput: true,
        defaultDate: defaultValue || undefined,
        // Append to body so the popup is not clipped by iframe overflow
        appendTo: document.body,
      });
    });
    return () => {
      destroyed = true;
      fpRef.current?.destroy();
    };
  }, [defaultValue, includeTime]);

  return (
    <div>
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
      <input
        ref={inputRef}
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={includeTime ? "YYYY/MM/DD HH:mm" : "YYYY/MM/DD"}
        style={{
          width: "100%",
          padding: "6px 12px",
          border: "1px solid #8c9196",
          borderRadius: "6px",
          fontSize: "14px",
          fontFamily: "inherit",
          lineHeight: "1.5",
          background: "#ffffff",
          color: "#202223",
          boxSizing: "border-box",
          cursor: "pointer",
        }}
      />
      {hint && (
        <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
