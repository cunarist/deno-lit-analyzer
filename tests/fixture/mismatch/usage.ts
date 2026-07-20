import { html, LitElement, type TemplateResult } from "lit";

import "./tag.ts";

function variantFor(kind: string): string {
  return kind === "npm" ? "brand" : "neutral";
}

export class UsageElement extends LitElement {
  override render(): TemplateResult {
    return html`<cl-tag variant="${variantFor("npm")}"></cl-tag>`;
  }
}
