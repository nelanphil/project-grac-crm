"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  CheckCustomerDuplicatesInput,
  CheckCustomerDuplicatesResult,
  checkCustomerDuplicates,
} from "@/lib/api";

const DEBOUNCE_MS = 400;

const EMPTY_RESULT: CheckCustomerDuplicatesResult = {
  accountName: { severity: "none", matches: [] },
  contacts: {},
  addresses: {},
};

export function firstBlockingDuplicateMessage(
  result: CheckCustomerDuplicatesResult | null | undefined,
): string | null {
  if (!result) return null;
  if (result.accountName.severity === "blocking") {
    return (
      result.accountName.message ??
      "A customer with this account name already exists."
    );
  }
  for (const contact of Object.values(result.contacts)) {
    if (contact.phone.severity === "blocking") {
      return (
        contact.phone.message ??
        "This phone number is already tied to a customer."
      );
    }
    if (contact.email.severity === "blocking") {
      return (
        contact.email.message ?? "This email is already tied to a customer."
      );
    }
  }
  for (const address of Object.values(result.addresses)) {
    if (address.severity === "blocking") {
      return (
        address.message ??
        "This address already exists on another customer record."
      );
    }
  }
  return null;
}

export function useCustomerDuplicateChecks(
  token: string | null,
  input: CheckCustomerDuplicatesInput,
) {
  const inputKey = useMemo(() => JSON.stringify(input), [input]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: CheckCustomerDuplicatesResult;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setChecking(true);
      setError(null);
      void checkCustomerDuplicates(
        token,
        JSON.parse(inputKey) as CheckCustomerDuplicatesInput,
      )
        .then((next) => {
          if (cancelled) return;
          setSnapshot({ key: inputKey, data: next });
        })
        .catch((err) => {
          if (cancelled) return;
          setError(
            err instanceof ApiError
              ? err.message
              : "Duplicate check failed.",
          );
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, inputKey]);

  const refresh = useCallback(async () => {
    if (!token) return null;
    setChecking(true);
    setError(null);
    try {
      const next = await checkCustomerDuplicates(
        token,
        JSON.parse(inputKey) as CheckCustomerDuplicatesInput,
      );
      setSnapshot({ key: inputKey, data: next });
      return next;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Duplicate check failed.",
      );
      return null;
    } finally {
      setChecking(false);
    }
  }, [token, inputKey]);

  const liveResult = token ? (snapshot?.data ?? EMPTY_RESULT) : EMPTY_RESULT;
  const stale = Boolean(token) && snapshot?.key !== inputKey;
  const blockingMessage = stale
    ? null
    : firstBlockingDuplicateMessage(liveResult);

  return {
    result: liveResult,
    stale,
    checking: Boolean(token) && (checking || stale),
    error,
    blockingMessage,
    hasBlocking: Boolean(blockingMessage),
    refresh,
  };
}
