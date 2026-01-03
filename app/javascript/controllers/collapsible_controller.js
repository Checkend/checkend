import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["content", "icon"]
  static values = { open: { type: Boolean, default: false } }

  connect() {
    this.updateVisibility()
  }

  toggle() {
    this.openValue = !this.openValue
    this.updateVisibility()
  }

  updateVisibility() {
    if (this.hasContentTarget) {
      this.contentTarget.classList.toggle('hidden', !this.openValue)
    }
    if (this.hasIconTarget) {
      this.iconTarget.style.transform = this.openValue ? 'rotate(180deg)' : 'rotate(0deg)'
    }
  }
}
