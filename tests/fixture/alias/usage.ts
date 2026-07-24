import { html, LitElement, type TemplateResult } from "lit";

import "#aliased";

function flavorFor(kind: string): string {
  return kind === "npm" ? "sweet" : "sour";
}

export class AliasUsageElement extends LitElement {
  override render(): TemplateResult {
    return html`<cl-aliased flavor="${flavorFor("npm")}"></cl-aliased>`;
  }
}
