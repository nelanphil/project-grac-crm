import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContactFormEmail } from "./emailTemplates";
import { parseContactFormNotification } from "./contactFormNotification";

describe("parseContactFormNotification", () => {
  it("reads the branded contact-form notification", () => {
    const mail = buildContactFormEmail({
      firstName: "Amy",
      lastName: "Webb",
      email: "Wsarmw@yahoo.com",
      phone: "(386) 451-3381",
      message:
        "The orange service lite is on and it says check battery.  Thank you.  Amy",
    });

    assert.deepEqual(
      parseContactFormNotification({ subject: mail.subject, text: mail.text }),
      {
        firstName: "Amy",
        lastName: "Webb",
        email: "Wsarmw@yahoo.com",
        phone: "(386) 451-3381",
        message:
          "The orange service lite is on and it says check battery.  Thank you.  Amy",
      },
    );
  });

  it("treats a missing phone as empty", () => {
    const mail = buildContactFormEmail({
      firstName: "Amy",
      lastName: "Webb",
      email: "Wsarmw@yahoo.com",
      phone: "",
      message: "Check battery.",
    });
    const parsed = parseContactFormNotification({
      subject: mail.subject,
      text: mail.text,
    });
    assert.equal(parsed?.phone, "");
  });

  it("rejects mail that is not a contact-form notification", () => {
    assert.equal(
      parseContactFormNotification({
        subject: "Hello",
        text: "Name: Amy Webb\nEmail: a@b.com\nMessage:\nHi\nReply to this email to respond to the sender.",
      }),
      null,
    );
  });
});
