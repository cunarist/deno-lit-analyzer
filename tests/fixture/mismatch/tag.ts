import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

export type TagVariant = "brand" | "neutral";

@customElement("cl-tag")
export class TagElement extends LitElement {
  @property({ type: String })
  accessor variant: TagVariant = "neutral";

  override render(): TemplateResult {
    return html`<span>${this.variant}</span>`;
  }
}
