import { html, LitElement, type TemplateResult } from "lit";

export class MixedElement extends LitElement {
  accessor value: string = "";

  override render(): TemplateResult {
    return html`
      <input value=${this.value}'>
    `;
  }
}
