export function isJobTerminalPopoutPath(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  return pathname.replace(/\/+$/, "") === "/dashboard/admin/terminal";
}

function copyStyles(fromDoc: Document, toDoc: Document): void {
  toDoc.documentElement.className = fromDoc.documentElement.className;
  toDoc.documentElement.style.height = "100%";
  toDoc.body.className = fromDoc.body.className;
  toDoc.body.style.cssText =
    "margin:0;height:100%;background:#0a0a0a;display:flex;flex-direction:column;";
  toDoc.title = "Backend terminal";

  const base = toDoc.createElement("base");
  base.href = fromDoc.baseURI;
  toDoc.head.prepend(base);

  const reset = toDoc.createElement("style");
  reset.textContent =
    "html,body,#job-terminal-mount{height:100%;margin:0;}#job-terminal-mount{display:flex;flex-direction:column;min-height:100%;}";
  toDoc.head.appendChild(reset);

  Array.from(fromDoc.styleSheets).forEach((sheet) => {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      if (!css) return;
      const style = toDoc.createElement("style");
      style.textContent = css;
      toDoc.head.appendChild(style);
    } catch {
      if (!sheet.href) return;
      const link = toDoc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      toDoc.head.appendChild(link);
    }
  });

  try {
    const adopted = fromDoc.adoptedStyleSheets;
    if (adopted?.length) {
      toDoc.adoptedStyleSheets = [...adopted];
    }
  } catch {
    /* Cross-document adopted sheets are not always writable. */
  }
}

function popupFeatures(width: number, height: number): string {
  const left = Math.max(
    0,
    Math.round(window.screenX + window.outerWidth - width - 12),
  );
  const top = Math.max(0, Math.round(window.screenY + 48));
  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "scrollbars=yes",
    "resizable=yes",
  ].join(",");
}

function openBlankPopup(width: number, height: number): Window | null {
  const features = popupFeatures(width, height);
  const popup = window.open("about:blank", "_blank", features);
  if (!popup) return null;

  try {
    popup.document.open();
    popup.document.write(
      "<!doctype html><html><head></head><body></body></html>",
    );
    popup.document.close();
  } catch {
    /* about:blank is already available */
  }

  copyStyles(document, popup.document);
  popup.focus();

  const left = Math.max(
    0,
    Math.round(window.screenX + window.outerWidth - width - 12),
  );
  const top = Math.max(0, Math.round(window.screenY + 48));
  window.setTimeout(() => {
    try {
      popup.resizeTo(width, height);
      popup.moveTo(left, top);
    } catch {
      /* Tabbed windows block resize. */
    }
  }, 50);

  return popup;
}

export async function openFloatingTerminalWindow(): Promise<Window | null> {
  const width = 440;
  const height = Math.min(
    820,
    Math.max(560, Math.round(window.screen.availHeight * 0.85)),
  );

  const dpip = (
    window as Window & {
      documentPictureInPicture?: {
        requestWindow: (opts?: {
          width?: number;
          height?: number;
        }) => Promise<Window>;
      };
    }
  ).documentPictureInPicture;

  // Chrome: a Document Picture-in-Picture window cannot become a full app tab.
  if (dpip) {
    try {
      const pip = await dpip.requestWindow({ width, height });
      copyStyles(document, pip.document);
      return pip;
    } catch {
      /* User dismissed it or the API refused; try a blank popup next. */
    }
  }

  return openBlankPopup(width, height);
}
