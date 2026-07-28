import { octicon } from "@/icons";

// late-2012 directory footer carried into the 2013 layout
export function mountFooter(): void {
  if (document.querySelector(".oldgh-footer")) return;
  const footer = document.createElement("footer");
  footer.className = "oldgh-footer";
  footer.dataset.oldgh = "footer";
  footer.innerHTML = renderFooterHtml();
  document.body.append(footer);
}

function renderFooterHtml(): string {
  const mark = octicon("mark-github", { size: 24, ariaLabel: "GitHub" });
  const columns: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
    {
      heading: "GitHub",
      links: [
        { label: "About us", href: "https://github.com/about" },
        { label: "Blog", href: "https://github.blog" },
        { label: "Contact & support", href: "https://support.github.com/contact" },
        { label: "GitHub Enterprise", href: "https://github.com/enterprise" },
        { label: "Site status", href: "https://www.githubstatus.com" },
      ],
    },
    {
      heading: "Applications",
      links: [
        { label: "GitHub for Mac", href: "https://desktop.github.com" },
        { label: "GitHub for Windows", href: "https://desktop.github.com" },
        { label: "GitHub for Eclipse", href: "https://github.com/eclipse/egit-github" },
        { label: "GitHub mobile apps", href: "https://github.com/mobile" },
      ],
    },
    {
      heading: "Services",
      links: [
        { label: "Gauges: Web analytics", href: "https://get.gaug.es" },
        { label: "Speaker Deck: Presentations", href: "https://speakerdeck.com" },
        { label: "Gist: Code snippets", href: "https://gist.github.com" },
        { label: "Job board", href: "https://www.github.careers" },
      ],
    },
    {
      heading: "Documentation",
      links: [
        { label: "GitHub Help", href: "https://docs.github.com" },
        { label: "Developer API", href: "https://docs.github.com/rest" },
        { label: "GitHub Flavored Markdown", href: "https://github.github.com/gfm" },
        { label: "GitHub Pages", href: "https://pages.github.com" },
      ],
    },
    {
      heading: "More",
      links: [
        { label: "Training", href: "https://github.com/skills" },
        { label: "Students & teachers", href: "https://github.com/education" },
        { label: "The Shop", href: "https://shop.github.com" },
        { label: "The Octodex", href: "https://octodex.github.com" },
      ],
    },
  ];
  const columnsHtml = columns.map((column) => `
    <section class="oldgh-footer__column">
      <h2>${column.heading}</h2>
      <ul>
        ${column.links.map((link) => `<li><a href="${link.href}" rel="noopener">${link.label}</a></li>`).join("")}
      </ul>
    </section>
  `).join("");
  return `
    <div class="oldgh-footer__inner">
      <div class="oldgh-footer__directory">${columnsHtml}</div>
      <div class="oldgh-footer__legal">
        <ul>
          <li><a href="https://docs.github.com/site-policy/github-terms/github-terms-of-service" rel="noopener">Terms of Service</a></li>
          <li><a href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement" rel="noopener">Privacy</a></li>
          <li><a href="https://github.com/security" rel="noopener">Security</a></li>
        </ul>
        <a class="oldgh-footer__mark" href="/" aria-label="GitHub">${mark}</a>
        <p>&copy; 2013 GitHub Inc. All rights reserved.</p>
      </div>
    </div>
  `;
}
