import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["message"]

  connect() {
    this.showMessages()
    document.addEventListener("flash:show", this.handleFlashEvent)
  }

  disconnect() {
    document.removeEventListener("flash:show", this.handleFlashEvent)
  }

  handleFlashEvent = (event) => {
    const { type, message } = event.detail
    this.createMessage(type, message)
  }

  createMessage(type, message) {
    const messageDiv = document.createElement("div")
    messageDiv.setAttribute("data-flash-message-target", "message")
    messageDiv.setAttribute("data-type", type)

    const styles = this.getStyles(type)
    messageDiv.className = `mb-2 px-4 py-3 rounded-lg border flex items-center gap-3 opacity-100 transition-opacity duration-300 ${styles.bg} ${styles.border} ${styles.text}`

    messageDiv.innerHTML = `
      ${this.getIcon(type)}
      <span class="flex-1 text-sm font-medium">${this.escapeHtml(message)}</span>
      <button type="button" data-action="flash-message#dismiss" class="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    `

    this.element.appendChild(messageDiv)
    this.scheduleAutoHide(messageDiv)
  }

  showMessages() {
    this.messageTargets.forEach((message) => {
      this.scheduleAutoHide(message)
    })
  }

  scheduleAutoHide(message) {
    setTimeout(() => {
      this.fadeOutMessage(message)
    }, 5000)
  }

  fadeOutMessage(message) {
    message.classList.remove("opacity-100")
    message.classList.add("opacity-0")

    message.addEventListener("transitionend", () => {
      message.remove()
    }, { once: true })
  }

  dismiss(event) {
    const message = event.target.closest("[data-flash-message-target='message']")
    if (message) {
      this.fadeOutMessage(message)
    }
  }

  getStyles(type) {
    switch (type) {
      case "notice":
      case "success":
        return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400" }
      case "alert":
      case "error":
        return { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400" }
      case "warning":
        return { bg: "bg-orange-400/10", border: "border-orange-400/30", text: "text-orange-400" }
      default:
        return { bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-400" }
    }
  }

  getIcon(type) {
    switch (type) {
      case "notice":
      case "success":
        return `<svg class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>`
      case "alert":
      case "error":
        return `<svg class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>`
      case "warning":
        return `<svg class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>`
      default:
        return `<svg class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>`
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }
}
