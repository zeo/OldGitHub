import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchPageDoc } from "@/adapters/_page";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-security";

type SecurityCard = {
  key: string;
  title: string;
  icon: string;
  status: "enabled" | "disabled" | "configurable" | "needs-setup";
  description: string;
  action: { label: string; href: string } | null;
};

type SecurityView = {
  owner: string;
  repo: string;
  features: SecurityCard[];
};

export async function mountRepoSecurity(owner: string, repo: string, subkind: "overview" | "advisories"): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${subkind}`;
  root.innerHTML = renderShell(owner, repo, subkind);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-security__main");
  if (!main) return;

  try {
    if (subkind === "advisories") {
      const advisories = await fetchAdvisories(owner, repo);
      main.innerHTML = renderAdvisories(owner, repo, advisories);
    } else {
      const view = await fetchSecurityView(owner, repo);
      main.innerHTML = renderOverview(view);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-security__empty">Couldn't load: ${escapeText(msg)}</div>`;
  }
}

type Advisory = {
  ghsaId: string;
  summary: string;
  severity: string;
  state: string;
  publishedAt: string | null;
  author: string | null;
  url: string;
};

// github's advisories page lists the same published advisories as the api, plus drafts for maintainers
async function fetchAdvisories(owner: string, repo: string): Promise<Advisory[]> {
  let doc: Document;
  try {
    doc = await fetchPageDoc(`https://github.com/${owner}/${repo}/security/advisories`);
  } catch (err) {
    if (err instanceof AdapterFailure && /\b404\b/.test(err.message)) return [];
    throw err;
  }
  return Array.from(doc.querySelectorAll("main li.Box-row")).flatMap((row) => {
    const link = row.querySelector<HTMLAnchorElement>('a[href*="/security/advisories/GHSA-"]');
    const href = link?.getAttribute("href");
    if (!link || !href) return [];
    const state = /^(\w+) advisory$/i.exec(row.querySelector("[aria-label$=' advisory']")?.getAttribute("aria-label") ?? "")?.[1];
    return [{
      ghsaId: href.split("/").pop()!,
      summary: text(link) || "Untitled advisory",
      severity: /^Severity: (\w+)/.exec(row.querySelector("[title^='Severity:']")?.getAttribute("title") ?? "")?.[1]?.toLowerCase() ?? "unknown",
      state: state?.toLowerCase() ?? "published",
      publishedAt: row.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? null,
      author: text(row.querySelector("a.author")) || null,
      url: href,
    }];
  });
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

// github calls it moderate, the 2013 palette names it medium
const SEVERITY_CLASS: Record<string, string> = { critical: "critical", high: "high", moderate: "medium", medium: "medium", low: "low" };

function renderAdvisories(owner: string, repo: string, items: Advisory[]): string {
  if (items.length === 0) {
    return `
      <div class="oldgh-security__empty oldgh-security__advisory-empty">
        ${octicon("megaphone", { size: 40 })}
        <h2>No published security advisories.</h2>
        <p>Security advisories let maintainers privately discuss and coordinate fixes for vulnerabilities, then publish them once a patch is ready.</p>
        <p><a class="oldgh-btn oldgh-btn--primary" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/security/advisories/new">${octicon("plus", { size: 12 })} <span>New draft advisory</span></a></p>
      </div>
    `;
  }
  return `
    <div class="oldgh-advisories__bar">
      <div><strong>${items.length}</strong> ${items.length === 1 ? "advisory" : "advisories"} published</div>
      <a class="oldgh-btn oldgh-btn--primary" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/security/advisories/new">${octicon("plus", { size: 12 })}<span>New draft</span></a>
    </div>
    <ul class="oldgh-advisories">
      ${items.map(renderAdvisoryRow).join("")}
    </ul>
  `;
}

function renderAdvisoryRow(a: Advisory): string {
  return `
    <li class="oldgh-advisories__item">
      <span class="oldgh-advisories__severity oldgh-advisories__severity--${SEVERITY_CLASS[a.severity] ?? "unknown"}" title="Severity: ${escapeAttr(a.severity)}">${escapeText(a.severity)}</span>
      <div class="oldgh-advisories__main">
        <h3 class="oldgh-advisories__title">
          <a href="${escapeAttr(a.url)}">${escapeText(a.summary)}</a>
        </h3>
        <div class="oldgh-advisories__meta">
          <code class="oldgh-advisories__id">${escapeText(a.ghsaId)}</code>
          ${a.state !== "published" ? `<span class="oldgh-advisories__state">${escapeText(a.state)}</span>` : ""}
          ${a.publishedAt ? `<span>published <time datetime="${escapeAttr(a.publishedAt)}">${escapeText(formatDate(a.publishedAt))}</time>${a.author ? ` by <a href="/${escapeAttr(a.author)}">${escapeText(a.author)}</a>` : ""}</span>` : ""}
        </div>
      </div>
    </li>
  `;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function fetchSecurityView(owner: string, repo: string): Promise<SecurityView> {
  // github renders the policy file on this page only when the repository has one
  const policyHref = `/${owner}/${repo}/security/policy`;
  const hasPolicy = (await fetchPageDoc(`https://github.com${policyHref}`)).querySelector("main .markdown-body") !== null;

  const features: SecurityCard[] = [
    {
      key: "security-policy",
      title: "Security policy",
      icon: "shield",
      status: hasPolicy ? "enabled" : "needs-setup",
      description: "Define how users should report security vulnerabilities for this repository.",
      action: hasPolicy
        ? { label: "View policy", href: policyHref }
        : { label: "Set up", href: `/${owner}/${repo}/security/policy/edit` },
    },
    {
      key: "advisories",
      title: "Security advisories",
      icon: "megaphone",
      status: "configurable",
      description: "View or disclose security advisories for this repository. Use draft advisories to coordinate disclosure privately before patching.",
      action: { label: "View advisories", href: `/${owner}/${repo}/security/advisories` },
    },
    {
      key: "private-reporting",
      title: "Private vulnerability reporting",
      icon: "lock",
      status: "configurable",
      description: "Allow users to privately report potential security vulnerabilities, so they can be triaged before going public.",
      action: { label: "Manage in settings", href: `/${owner}/${repo}/settings/security_analysis` },
    },
    {
      key: "dependabot",
      title: "Dependabot alerts",
      icon: "package",
      status: "configurable",
      description: "Get notified when one of your dependencies has a known vulnerability. Pair with auto-updates to keep things patched.",
      action: { label: "Configure Dependabot", href: `/${owner}/${repo}/security/dependabot` },
    },
    {
      key: "code-scanning",
      title: "Code scanning",
      icon: "search",
      status: "configurable",
      description: "Automatically detect common vulnerability and coding errors in your code with CodeQL or third-party tools.",
      action: { label: "Set up code scanning", href: `/${owner}/${repo}/security/code-scanning` },
    },
    {
      key: "secret-scanning",
      title: "Secret scanning",
      icon: "key",
      status: "configurable",
      description: "GitHub scans every push for known secret formats (tokens, private keys, etc.) and alerts you so you can rotate them.",
      action: { label: "View detected secrets", href: `/${owner}/${repo}/security/secret-scanning` },
    },
  ];

  return {
    owner,
    repo,
    features,
  };
}

function renderShell(owner: string, repo: string, subkind: "overview" | "advisories"): string {
  const items: Array<{ key: string; label: string; icon: string; href: string }> = [
    { key: "overview", label: "Overview", icon: "shield", href: `/${owner}/${repo}/security` },
    { key: "advisories", label: "Advisories", icon: "megaphone", href: `/${owner}/${repo}/security/advisories` },
  ];
  return `
    <div class="oldgh-page">
      <header class="oldgh-security__header">
        <h1>${octicon("shield", { size: 22 })} Security: <strong>${escapeText(owner)}/${escapeText(repo)}</strong></h1>
      </header>
      <div class="oldgh-security__layout">
        <aside class="oldgh-security__sidebar">
          <ul class="oldgh-security__nav">
            ${items.map((it) => `
              <li class="${subkind === it.key ? "is-active" : ""}">
                <a href="${escapeAttr(it.href)}">${octicon(it.icon, { size: 14 })}<span>${escapeText(it.label)}</span></a>
              </li>
            `).join("")}
          </ul>
        </aside>
        <main class="oldgh-security__main">
          <div class="oldgh-security__loading">Loading ${subkind === "advisories" ? "advisories" : "security overview"}&hellip;</div>
        </main>
      </div>
    </div>
  `;
}

function renderOverview(v: SecurityView): string {
  const enabledCount = v.features.filter((f) => f.status === "enabled").length;
  return `
    <div class="oldgh-security__hero">
      <div class="oldgh-security__hero-icon">${octicon("shield", { size: 32 })}</div>
      <div class="oldgh-security__hero-text">
        <h2>Security and analysis</h2>
        <p>${enabledCount > 0
          ? `<strong>${enabledCount}</strong> of <strong>${v.features.length}</strong> recommended features are configured for this repo.`
          : `Configure the recommended features below to improve this repository's security posture.`}</p>
      </div>
    </div>
    <ul class="oldgh-security__features">
      ${v.features.map(renderFeature).join("")}
    </ul>
  `;
}

function renderFeature(f: SecurityCard): string {
  const statusChip = f.status === "enabled"
    ? `<span class="oldgh-security__status oldgh-security__status--on">${octicon("check", { size: 12 })} Enabled</span>`
    : `<span class="oldgh-security__status oldgh-security__status--off">${octicon("primitive-dot", { size: 12 })} Not configured</span>`;
  return `
    <li class="oldgh-security__feature">
      <div class="oldgh-security__feature-icon">${octicon(f.icon, { size: 18 })}</div>
      <div class="oldgh-security__feature-main">
        <h3 class="oldgh-security__feature-title">
          ${escapeText(f.title)}
          ${statusChip}
        </h3>
        <p class="oldgh-security__feature-desc">${escapeText(f.description)}</p>
      </div>
      ${f.action ? `<a class="oldgh-btn oldgh-security__feature-action" href="${escapeAttr(f.action.href)}">${escapeText(f.action.label)}</a>` : ""}
    </li>
  `;
}
