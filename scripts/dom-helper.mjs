import { Window } from "happy-dom";

const DOM_KEYS = [
  "window",
  "document",
  "DOMParser",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLAnchorElement",
  "HTMLDetailsElement",
  "HTMLLabelElement",
  "HTMLMetaElement",
  "HTMLImageElement",
  "HTMLTableCellElement",
  "HTMLTableRowElement",
  "HTMLUListElement",
  "HTMLDivElement",
  "HTMLLinkElement",
  "HTMLScriptElement",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
  "navigator",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "matchMedia",
  "CSS",
];

export function withDom(html = "<!doctype html><html><head></head><body></body></html>", url = "https://github.com/") {
  const win = new Window({ url });
  win.document.open();
  win.document.write(html);
  win.document.close();

  const saved = new Map();
  for (const key of DOM_KEYS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "window" ? win : win[key];
    if (value !== undefined) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value: typeof value === "function" && !String(value).startsWith("class ") && key !== "DOMParser" && key !== "Node" && !key.endsWith("Element") && !key.endsWith("Event")
          ? value.bind(win)
          : value,
      });
    }
  }

  return () => {
    for (const [key, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
    win.close();
  };
}
