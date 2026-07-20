import { html, LitElement, type TemplateResult } from "lit";

export class BadElement extends LitElement {
  override render(): TemplateResult {
    return html`<div><span>unclosed</div>`;
  }
}
