import { AdapterFailure } from "./index";

export type Me = {
  login: string;
  avatarUrl: string;
  profileUrl: string;
};

export async function getMe(): Promise<Me> {
  const inline = readFromCurrentDocument();
  if (inline) return inline;

  const resp = await fetch("https://github.com/settings/profile", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getMe", `settings/profile responded ${resp.status}`);
  }
  const html = await resp.text();
  const me = readFromHtml(html);
  if (!me) {
    throw new AdapterFailure("getMe", "could not extract user-login meta from settings/profile");
  }
  return me;
}

function readFromCurrentDocument(): Me | null {
  return readFromDocument(document);
}

function readFromHtml(html: string): Me | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readFromDocument(doc);
}

function readFromDocument(doc: Document): Me | null {
  const login = doc.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content?.trim();
  if (!login) return null;

  const explicit = doc.querySelector<HTMLMetaElement>('meta[name="user-avatar"]')?.content?.trim();
  const avatarUrl = explicit && explicit.length > 0 ? explicit : `https://github.com/${login}.png?size=80`;

  return {
    login,
    avatarUrl,
    profileUrl: `https://github.com/${login}`,
  };
}
