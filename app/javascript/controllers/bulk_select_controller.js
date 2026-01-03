import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["count"]

  connect() {
    this.updateCount()
  }

  toggleAll(event) {
    const checkboxes = this.element.querySelectorAll('input[name="problem_ids[]"]')
    checkboxes.forEach(checkbox => {
      checkbox.checked = event.target.checked
    })
    this.updateCount()
  }

  toggle() {
    this.updateCount()
  }

  updateCount() {
    const checkboxes = this.element.querySelectorAll('input[name="problem_ids[]"]:checked')
    const count = checkboxes.length
    if (this.hasCountTarget) {
      this.countTarget.textContent = `${count} selected`
    }
  }
}
