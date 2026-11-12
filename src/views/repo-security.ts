import { octicon } from "@/icons";
import { fetchApi } from "@/adapters/rate-limit";
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
  hasSecurityPolicy: boolean;
  securityPolicyUrl: string | null;
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
  cveId: string | null;
  summary: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  state: "draft" | "triage" | "published" | "closed" | "withdrawn";
  cvssScore: number | null;
  publishedAt: string | null;
  updatedAt: string | null;
  url: string;
  vulnerabilities: Array<{ ecosystem: string | null; packageName: string | null }>;
};

async function fetchAdvisories(owner: string, repo: string): Promise<Advisory[]> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/security-advisories?per_page=30`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`responded ${resp.status}`);
  }
  const data = (await resp.json()) as unknown[];
  if (!Array.isArray(data)) return [];
  return data.map(parseAdvisory).filter((a): a is Advisory => a !== null);
}

function parseAdvisory(raw: unknown): Advisory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ghsaId = typeof r["ghsa_id"] === "string" ? (r["ghsa_id"] as string) : null;
  if (!ghsaId) return null;
  const cvss = r["cvss"] && typeof r["cvss"] === "object" ? (r["cvss"] as Record<string, unknown>) : null;
  const vulns = Array.isArray(r["vulnerabilities"]) ? (r["vulnerabilities"] as unknown[]) : [];
  return {
    ghsaId,
    cveId: typeof r["cve_id"] === "string" ? (r["cve_id"] as string) : null,
    summary: (typeof r["summary"] === "string" ? (r["summary"] as string) : "") || "Untitled advisory",
    description: typeof r["description"] === "string" ? (r["description"] as string) : null,
    severity: ((typeof r["severity"] === "string" ? (r["severity"] as string) : "unknown") as Advisory["severity"]),
    state: ((typeof r["state"] === "string" ? (r["state"] as string) : "published") as Advisory["state"]),
    cvssScore: cvss && typeof cvss["score"] === "number" ? (cvss["score"] as number) : null,
    publishedAt: typeof r["published_at"] === "string" ? (r["published_at"] as string) : null,
    updatedAt: typeof r["updated_at"] === "string" ? (r["updated_at"] as string) : null,
    url: (typeof r["html_url"] === "string" ? (r["html_url"] as string) : `/advisories/${ghsaId}`).replace(/^https:\/\/github\.com/, ""),
    vulnerabilities: vulns
      .map((v) => {
        if (!v || typeof v !== "object") return null;
        const vo = v as Record<string, unknown>;
        const pkg = vo["package"] && typeof vo["package"] === "object" ? (vo["package"] as Record<string, unknown>) : null;
        return {
          ecosystem: pkg && typeof pkg["ecosystem"] === "string" ? (pkg["ecosystem"] as string) : null,
          packageName: pkg && typeof pkg["name"] === "string" ? (pkg["name"] as string) : null,
        };
      })
      .filter((v): v is { ecosystem: string | null; packageName: string | null } => v !== null && (v.ecosystem !== null || v.packageName !== null)),
  };
}

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
  const sev = a.severity || "unknown";
  return `
    <li class="oldgh-advisories__item oldgh-advisories__item--${sev}">
      <span class="oldgh-advisories__severity oldgh-advisories__severity--${sev}" title="Severity: ${escapeAttr(sev)}">${sev.charAt(0).toUpperCase()}${sev.slice(1)}</span>
      <div class="oldgh-advisories__main">
        <h3 class="oldgh-advisories__title">
          <a href="${escapeAttr(a.url)}">${escapeText(a.summary)}</a>
        </h3>
        <div class="oldgh-advisories__meta">
          <code class="oldgh-advisories__id">${escapeText(a.ghsaId)}</code>
          ${a.cveId ? `<code class="oldgh-advisories__id">${escapeText(a.cveId)}</code>` : ""}
          ${a.cvssScore !== null ? `<span class="oldgh-advisories__cvss">CVSS ${a.cvssScore.toFixed(1)}</span>` : ""}
          ${a.state !== "published" ? `<span class="oldgh-advisories__state">${escapeText(a.state)}</span>` : ""}
          ${a.publishedAt ? `<time datetime="${escapeAttr(a.publishedAt)}">${escapeText(formatDate(a.publishedAt))}</time>` : ""}
        </div>
        ${a.vulnerabilities.length > 0
          ? `<ul class="oldgh-advisories__packages">${a.vulnerabilities.slice(0, 6).map((v) => `<li><code>${escapeText(v.ecosystem ? v.ecosystem + (v.packageName ? `: ${v.packageName}` : "") : (v.packageName || ""))}</code></li>`).join("")}</ul>`
          : ""}
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
  // Pull community profile to learn if there's a security policy file.
  const community = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/community/profile`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  let securityFile: { html_url?: string; name?: string } | null = null;
  if (community.ok) {
    const j = (await community.json()) as Record<string, unknown>;
    const files = (j["files"] && typeof j["files"] === "object" ? j["files"] : null) as Record<string, unknown> | null;
    const sec = files?.["security"];
    if (sec && typeof sec === "object") {
      securityFile = sec as { html_url?: string; name?: string };
    }
  }

  const features: SecurityCard[] = [
    {
      key: "security-policy",
      title: "Security policy",
      icon: "shield",
      status: securityFile ? "enabled" : "needs-setup",
      description: securityFile
        ? `Define how users should report security vulnerabilities for this repository. Current policy: ${securityFile.name || "SECURITY.md"}.`
        : "Define how users should report security vulnerabilities for this repository.",
      action: securityFile?.html_url
        ? { label: "View policy", href: securityFile.html_url }
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
    hasSecurityPolicy: !!securityFile,
    securityPolicyUrl: securityFile?.html_url ?? null,
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
