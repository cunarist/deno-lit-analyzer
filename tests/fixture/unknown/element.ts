import { html, LitElement, type TemplateResult } from "lit";

export class UnknownTagElement extends LitElement {
  override render(): TemplateResult {
    return html`<cl-never-defined></cl-never-defined>`;
  }
}
