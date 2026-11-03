export const ARROW_TRIANGLE_SVG =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.92877 5.96967C4.22166 5.67678 4.69653 5.67678 4.98943 5.96967L7.99463 8.97487L10.9998 5.96967C11.2927 5.67678 11.7676 5.67678 12.0605 5.96967C12.3534 6.26256 12.3534 6.73744 12.0605 7.03033L8.52496 10.5659C8.23207 10.8588 7.75719 10.8588 7.4643 10.5659L3.92877 7.03033C3.63587 6.73744 3.63587 6.26256 3.92877 5.96967Z"></path></svg>';

export function createArrowTriangle(expanded = false): HTMLElement {
  const container = document.createElement("span");
  container.className = `ci-arrow-triangle ${expanded ? "is-expanded" : "is-collapsed"}`;
  container.innerHTML = ARROW_TRIANGLE_SVG;
  return container;
}

export function setArrowTriangleExpanded(
  el: HTMLElement | null,
  expanded: boolean,
): void {
  if (!el) return;
  el.classList.toggle("is-expanded", expanded);
  el.classList.toggle("is-collapsed", !expanded);
}
