import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "list", "suggestions", "inputWrapper"]
  static values = { url: String }

  connect() {
    this.selectedIndex = -1
    document.addEventListener('click', this.handleClickOutside.bind(this))
  }

  disconnect() {
    document.removeEventListener('click', this.handleClickOutside.bind(this))
  }

  handleClickOutside(event) {
    if (!this.element.contains(event.target)) {
      this.hideSuggestions()
    }
  }

  async search() {
    const query = this.inputTarget.value.trim()

    try {
      const response = await fetch(`${this.urlValue}?q=${encodeURIComponent(query)}`, {
        headers: {
          'Accept': 'application/json',
          'X-CSRF-Token': this.csrfToken
        }
      })

      if (response.ok) {
        const data = await response.json()
        this.renderSuggestions(data.tags, query, data.can_create)
      }
    } catch (error) {
      console.error('Error fetching tags:', error)
    }
  }

  renderSuggestions(tags, query, canCreate) {
    this.suggestionsTarget.innerHTML = ''
    this.selectedIndex = -1

    if (tags.length === 0 && !canCreate) {
      if (query) {
        this.suggestionsTarget.innerHTML = `
          <div class="px-3 py-2 text-sm text-gray-500 dark:text-zinc-400">
            Tag already added
          </div>
        `
        this.showSuggestions()
      } else {
        this.hideSuggestions()
      }
      return
    }

    const ul = document.createElement('ul')
    ul.className = 'py-1'

    tags.forEach((tag, index) => {
      const li = document.createElement('li')
      li.innerHTML = `
        <button type="button"
                class="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 focus:bg-gray-100 dark:focus:bg-zinc-700 focus:outline-none suggestion-item"
                data-tag-id="${tag.id}"
                data-tag-name="${tag.name}"
                data-action="click->tags#selectExisting">
          ${this.escapeHtml(tag.name)}
        </button>
      `
      ul.appendChild(li)
    })

    if (canCreate && query) {
      const li = document.createElement('li')
      li.innerHTML = `
        <button type="button"
                class="w-full text-left px-3 py-2 text-sm text-violet-600 dark:text-violet-400 hover:bg-gray-100 dark:hover:bg-zinc-700 focus:bg-gray-100 dark:focus:bg-zinc-700 focus:outline-none suggestion-item"
                data-tag-name="${this.escapeHtml(query)}"
                data-action="click->tags#createNew">
          Create "<strong>${this.escapeHtml(query)}</strong>"
        </button>
      `
      ul.appendChild(li)
    }

    this.suggestionsTarget.appendChild(ul)
    this.showSuggestions()
  }

  showSuggestions() {
    this.suggestionsTarget.classList.remove('hidden')
  }

  hideSuggestions() {
    this.suggestionsTarget.classList.add('hidden')
    this.selectedIndex = -1
  }

  keydown(event) {
    const items = this.suggestionsTarget.querySelectorAll('.suggestion-item')

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1)
      this.highlightItem(items)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
      this.highlightItem(items)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
        items[this.selectedIndex].click()
      } else if (this.inputTarget.value.trim()) {
        this.createNew({ currentTarget: { dataset: { tagName: this.inputTarget.value.trim() } } })
      }
    } else if (event.key === 'Escape') {
      this.hideSuggestions()
      this.inputTarget.blur()
    }
  }

  highlightItem(items) {
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.classList.add('bg-gray-100', 'dark:bg-zinc-700')
      } else {
        item.classList.remove('bg-gray-100', 'dark:bg-zinc-700')
      }
    })
  }

  async selectExisting(event) {
    const tagName = event.currentTarget.dataset.tagName
    await this.addTag(tagName)
  }

  async createNew(event) {
    const tagName = event.currentTarget.dataset.tagName
    await this.addTag(tagName)
  }

  async addTag(tagName) {
    try {
      const response = await fetch(this.urlValue, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': this.csrfToken
        },
        body: JSON.stringify({ name: tagName })
      })

      if (response.ok) {
        const tag = await response.json()
        this.appendTagBadge(tag)
        this.inputTarget.value = ''
        this.hideSuggestions()
      } else {
        const error = await response.json()
        console.error('Error adding tag:', error)
      }
    } catch (error) {
      console.error('Error adding tag:', error)
    }
  }

  appendTagBadge(tag) {
    const badge = document.createElement('span')
    badge.className = 'inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 group'
    badge.dataset.tagId = tag.id
    badge.innerHTML = `
      ${this.escapeHtml(tag.name)}
      <button type="button" data-action="tags#remove" data-tag-id="${tag.id}" class="ml-1.5 text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-200 focus:outline-none">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    `
    this.listTarget.appendChild(badge)
  }

  async remove(event) {
    const tagId = event.currentTarget.dataset.tagId
    const badge = this.listTarget.querySelector(`[data-tag-id="${tagId}"]`)

    try {
      const response = await fetch(`${this.urlValue}/${tagId}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'X-CSRF-Token': this.csrfToken
        }
      })

      if (response.ok) {
        badge?.remove()
      } else {
        console.error('Error removing tag')
      }
    } catch (error) {
      console.error('Error removing tag:', error)
    }
  }

  get csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content
  }

  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }
}
