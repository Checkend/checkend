import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["lightIcon", "darkIcon"]

  connect() {
    this.applyTheme(this.currentTheme)
  }

  toggle() {
    const newTheme = this.currentTheme === "dark" ? "light" : "dark"
    this.applyTheme(newTheme)
    localStorage.setItem("theme", newTheme)
  }

  applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
      this.lightIconTarget.classList.add("hidden")
      this.darkIconTarget.classList.remove("hidden")
    } else {
      document.documentElement.classList.remove("dark")
      this.lightIconTarget.classList.remove("hidden")
      this.darkIconTarget.classList.add("hidden")
    }
  }

  get currentTheme() {
    return localStorage.getItem("theme") ||
           (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  }
}
