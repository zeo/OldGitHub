const BODY_ROOT_CLASS = "oldgh-body-root";

let navigation = 0;

export function beginNavigation(): number {
  return ++navigation;
}

export function navigationToken(): number {
  return navigation;
}

export function isCurrentNavigation(nav: number): boolean {
  return nav === navigation;
}

// a view that awaited across a newer navigation gets false and must not touch the page
export function adoptBodyRoot(root: HTMLElement, afterSelector?: string, nav?: number): boolean {
  if (nav !== undefined && !isCurrentNavigation(nav)) return false;
  root.classList.add(BODY_ROOT_CLASS);
  removeAllBodyRoots();
  if (afterSelector) {
    const after = document.querySelector(afterSelector);
    if (after && after.parentNode) {
      after.after(root);
      return true;
    }
  }
  // Insert before the footer so the page reads header → content → footer.
  // adoptBodyRoot fires once per navigation, so a stale append-to-body would
  // otherwise push every new body root below the footer mounted at boot.
  const footer = document.querySelector(".oldgh-footer");
  if (footer && footer.parentNode === document.body) {
    document.body.insertBefore(root, footer);
  } else {
    document.body.append(root);
  }
  return true;
}

export function removeAllBodyRoots(): void {
  document.querySelectorAll(`.${BODY_ROOT_CLASS}`).forEach((el) => el.remove());
}

export function hasMountedBody(): boolean {
  return !!document.querySelector(`.${BODY_ROOT_CLASS}`);
}
