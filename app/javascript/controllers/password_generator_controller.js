import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input"]

  generate() {
    const password = this.generateSecurePassword()
    this.inputTarget.value = password
    this.inputTarget.type = "text"
    this.inputTarget.focus()
  }

  generateSecurePassword() {
    const length = 16
    const lowercase = "abcdefghijklmnopqrstuvwxyz"
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    const numbers = "0123456789"
    const symbols = "!@#$%^&*"
    const allChars = lowercase + uppercase + numbers + symbols

    let password = ""

    // Ensure at least one of each type
    password += lowercase[Math.floor(Math.random() * lowercase.length)]
    password += uppercase[Math.floor(Math.random() * uppercase.length)]
    password += numbers[Math.floor(Math.random() * numbers.length)]
    password += symbols[Math.floor(Math.random() * symbols.length)]

    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)]
    }

    // Shuffle the password
    return password.split("").sort(() => Math.random() - 0.5).join("")
  }
}
