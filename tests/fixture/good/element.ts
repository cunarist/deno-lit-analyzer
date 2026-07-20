import { html, LitElement, type TemplateResult } from "lit";

export class GoodElement extends LitElement {
  override render(): TemplateResult {
    const handleClick = (): void => {};
    return html`<div @click="${handleClick}"><span>ok</span></div>`;
  }
}
