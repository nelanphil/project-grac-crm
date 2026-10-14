import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAILBOX_CREDENTIAL_MESSAGE,
  MAILBOX_TEMPORARY_LOGIN_MESSAGE,
  MailboxError,
  chooseMailboxLocation,
  isTemporaryImapAuthFailure,
  toMailboxError,
  unseenFromQuery,
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

describe("chooseMailboxLocation", () => {
  const sentOriginal = {
    folder: "sent" as const,
    uid: 4,
    dateMs: 100,
    messageId: "<parent@example.com>",
  };
  const inboxReply = {
    folder: "inbox" as const,
    uid: 9,
    dateMs: 300,
    messageId: "<reply@example.com>",
  };

  it("prefers the Sent message whose Message-ID matches", () => {
    assert.deepEqual(
      chooseMailboxLocation("<parent@example.com>", [inboxReply, sentOriginal]),
      { folder: "sent", uid: 4 },
    );
  });

  it("uses the newest related message when Sent has no exact copy", () => {
    assert.deepEqual(
      chooseMailboxLocation("parent@example.com", [
        { ...inboxReply, dateMs: 200 },
        {
          folder: "inbox",
          uid: 2,
          dateMs: 50,
          messageId: "<older@example.com>",
        },
      ]),
      { folder: "inbox", uid: 9 },
    );
  });

  it("returns null when nothing matched", () => {
    assert.equal(chooseMailboxLocation("<parent@example.com>", []), null);
  });
});

describe("unseenFromQuery", () => {
  it("searches nothing when there are no addresses", () => {
    assert.equal(unseenFromQuery(["", "  "]), null);
  });

  it("requires the message to be unseen and from that address", () => {
    assert.deepEqual(unseenFromQuery([" Laura@Example.com "]), {
      seen: false,
      from: "laura@example.com",
    });
  });

  it("ORs distinct addresses and ignores duplicates", () => {
    assert.deepEqual(
      unseenFromQuery(["a@example.com", "A@example.com", "b@example.com"]),
      {
        seen: false,
        or: [{ from: "a@example.com" }, { from: "b@example.com" }],
      },
    );
  });
});
