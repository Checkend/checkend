import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "currentPassword",
    "newPassword",
    "confirmPassword",
    "submitButton",
    "currentPasswordIcon",
    "newPasswordIcon",
    "confirmPasswordIcon"
  ]
  static values = {
    verifyUrl: String,
    debounceMs: { type: Number, default: 500 },
    minLength: { type: Number, default: 8 }
  }

  connect() {
    this.currentPasswordVerified = false
    this.checking = false
    this.debounceTimer = null
    this.updateSubmitButton()
  }

  disconnect() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
  }

  // Current password verification with debounce
  checkCurrentPassword() {
    const password = this.currentPasswordTarget.value

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    if (!password || password.length === 0) {
      this.currentPasswordVerified = false
      this.checking = false
      this.showIcon(this.currentPasswordIconTarget, 'idle')
      this.updateSubmitButton()
      return
    }

    this.checking = true
    this.currentPasswordVerified = false
    this.showIcon(this.currentPasswordIconTarget, 'checking')
    this.updateSubmitButton()

    this.debounceTimer = setTimeout(() => {
      this.verifyCurrentPassword(password)
    }, this.debounceMsValue)
  }

  async verifyCurrentPassword(password) {
    try {
      const response = await fetch(this.verifyUrlValue, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
        },
        body: JSON.stringify({ current_password: password })
      })

      const data = await response.json()

      this.checking = false
      this.currentPasswordVerified = data.valid

      if (data.valid) {
        this.showIcon(this.currentPasswordIconTarget, 'valid')
      } else {
        this.showIcon(this.currentPasswordIconTarget, 'invalid')
      }
    } catch (error) {
      console.error('Password verification error:', error)
      this.checking = false
      this.currentPasswordVerified = false
      this.showIcon(this.currentPasswordIconTarget, 'error')
    }

    this.updateSubmitButton()
  }

  // New password validation
  validateNewPassword() {
    const password = this.newPasswordTarget.value
    const confirmation = this.hasConfirmPasswordTarget ? this.confirmPasswordTarget.value : ''

    // Validate length
    if (!password || password.length === 0) {
      this.showIcon(this.newPasswordIconTarget, 'idle')
    } else if (password.length < this.minLengthValue) {
      this.showIcon(this.newPasswordIconTarget, 'invalid')
    } else {
      this.showIcon(this.newPasswordIconTarget, 'valid')
    }

    // Also revalidate confirmation if it has content
    if (confirmation.length > 0) {
      this.validateConfirmPassword()
    }

    this.updateSubmitButton()
  }

  // Confirm password validation
  validateConfirmPassword() {
    const password = this.newPasswordTarget.value
    const confirmation = this.confirmPasswordTarget.value

    if (!confirmation || confirmation.length === 0) {
      this.showIcon(this.confirmPasswordIconTarget, 'idle')
    } else if (confirmation !== password) {
      this.showIcon(this.confirmPasswordIconTarget, 'invalid')
    } else if (password.length >= this.minLengthValue) {
      this.showIcon(this.confirmPasswordIconTarget, 'valid')
    } else {
      // Password matches but is too short
      this.showIcon(this.confirmPasswordIconTarget, 'invalid')
    }

    this.updateSubmitButton()
  }

  // Check if all validations pass
  isFormValid() {
    if (!this.currentPasswordVerified || this.checking) {
      return false
    }

    const newPassword = this.newPasswordTarget.value
    const confirmation = this.confirmPasswordTarget.value

    if (!newPassword || newPassword.length < this.minLengthValue) {
      return false
    }

    if (newPassword !== confirmation) {
      return false
    }

    return true
  }

  // Icon display helper
  showIcon(target, state) {
    if (!target) return

    const icons = {
      idle: '',
      checking: `
        <svg class="animate-spin size-5 text-gray-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      `,
      valid: `
        <svg class="size-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
      `,
      invalid: `
        <svg class="size-5 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      `,
      error: `
        <svg class="size-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      `
    }

    target.innerHTML = icons[state] || ''
  }

  updateSubmitButton() {
    if (this.hasSubmitButtonTarget) {
      const shouldDisable = !this.isFormValid()
      this.submitButtonTarget.disabled = shouldDisable

      if (shouldDisable) {
        this.submitButtonTarget.classList.add('opacity-50', 'cursor-not-allowed')
        this.submitButtonTarget.classList.remove('hover:bg-violet-500')
      } else {
        this.submitButtonTarget.classList.remove('opacity-50', 'cursor-not-allowed')
        this.submitButtonTarget.classList.add('hover:bg-violet-500')
      }
    }
  }
}
