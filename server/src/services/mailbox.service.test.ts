import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAILBOX_CREDENTIAL_MESSAGE,
  MAILBOX_TEMPORARY_LOGIN_MESSAGE,
  MailboxError,
  isTemporaryImapAuthFailure,
  toMailboxError,
} from "./mailbox.service";

describe("isTemporaryImapAuthFailure", () => {
  it("treats UNAVAILABLE as a temporary refusal", () => {
    const err = {
      authenticationFailed: true,
      serverResponseCode: "UNAVAILABLE",
      response:
        "2 NO [UNAVAILABLE] Temporary authentication failure. [pe-dovecot]",
      message: "Command failed",
    };
    assert.equal(isTemporaryImapAuthFailure(err), true);
  });

  it("treats the temporary-failure text as temporary when the code is missing", () => {
    assert.equal(
      isTemporaryImapAuthFailure({
        authenticationFailed: true,
        message: "Temporary authentication failure",
      }),
      true,
    );
  });

  it("keeps AUTHENTICATIONFAILED as a credential error", () => {
    assert.equal(
      isTemporaryImapAuthFailure({
        authenticationFailed: true,
        serverResponseCode: "AUTHENTICATIONFAILED",
        response: "2 NO [AUTHENTICATIONFAILED] Authentication failed.",
        message: "Command failed",
      }),
      false,
    );
  });

  it("does not treat AUTHENTICATIONFAILED as temporary when the text says temporary", () => {
    assert.equal(
      isTemporaryImapAuthFailure({
        authenticationFailed: true,
        serverResponseCode: "AUTHENTICATIONFAILED",
        response: "Temporary authentication failure",
      }),
      false,
    );
  });
});

describe("toMailboxError", () => {
  it("maps a temporary refusal to the mailbox-password guidance", () => {
    const mapped = toMailboxError({
      authenticationFailed: true,
      serverResponseCode: "UNAVAILABLE",
      response: "2 NO [UNAVAILABLE] Temporary authentication failure.",
      message: "Command failed",
    });
    assert.ok(mapped instanceof MailboxError);
    assert.equal(mapped.message, MAILBOX_TEMPORARY_LOGIN_MESSAGE);
    assert.equal(mapped.status, 503);
  });

  it("maps a permanent authentication failure to the credential message", () => {
    const mapped = toMailboxError({
      authenticationFailed: true,
      serverResponseCode: "AUTHENTICATIONFAILED",
      message: "Command failed",
    });
    assert.equal(mapped.message, MAILBOX_CREDENTIAL_MESSAGE);
    assert.equal(mapped.status, 401);
  });

  it("passes through an existing MailboxError", () => {
    const original = new MailboxError("IMAP is not configured for this account.", 400);
    assert.equal(toMailboxError(original), original);
  });
});
