import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

export type Flavor = "sweet" | "sour";

@customElement("cl-aliased")
export class AliasedElement extends LitElement {
  @property({ type: String })
  accessor flavor: Flavor = "sweet";

  override render(): TemplateResult {
    return html`<span>${this.flavor}</span>`;
  }
}
