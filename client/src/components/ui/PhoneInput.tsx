"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { formatUsPhoneInput } from "@/lib/formatPhone";

type PhoneInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "maxLength"
>;

const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput(
    {
      value,
      onChange,
      placeholder = "(386) 363-3750",
      autoComplete = "tel",
      ...props
    },
    ref,
  ) {
    return (
      <input
        {...props}
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        maxLength={14}
        placeholder={placeholder}
        value={typeof value === "string" ? formatUsPhoneInput(value) : value}
        onChange={(e) => {
          e.target.value = formatUsPhoneInput(e.target.value);
          onChange?.(e);
        }}
      />
    );
  },
);

export default PhoneInput;
