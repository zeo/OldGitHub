export type PageMode = "on" | "native" | "signed-out" | "off";

export type ProxyFetchResult =
  | { ok: true; status: number; contentType: string; text: string }
  | { ok: false; status: number; error?: string };

export type RuntimeMessage =
  | { type: "oldgh:route-change"; pathname: string; search: string }
  | { type: "oldgh:page-mode"; mode: PageMode }
  | { type: "oldgh:open-options" }
  | { type: "oldgh:pre-navigate-uncovered" }
  | { type: "oldgh:fetch"; url: string; credentials: "include" | "omit" }
  | { type: "oldgh:set-enabled"; enabled: boolean };
